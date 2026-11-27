// Looks up each lead's own website and fills in what the posts left out (address, times, more dates, sign-up link).
// Usage: npm run enrich [-- --all] [--redo]   (--all includes past leads; --redo searches again)
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Page } from 'playwright';
import { DATA_DIR } from './db.ts';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from './db.ts';
import { groupMentions, nameTokens, similarNames, outOfArea, type Lead, type Event } from './group.ts';
import { loadMentions, isUpcoming, today } from './leads.ts';

const BIN = new URL('../extractor/.build/release/extract', import.meta.url).pathname;
// Sites that need a login or only repeat the posts we already have.
const SKIP = /instagram\.com|facebook\.com|fb\.com|tiktok\.com|threads\.net|x\.com|twitter\.com|pinterest\.|youtube\.com/;

export type Enrichment = { key: string; url: string | null; event: Event | null };

export function ensureTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS enrichments (key TEXT PRIMARY KEY, url TEXT, event TEXT, searched_at INTEGER NOT NULL)`);
}

export function loadEnrichments(db: DatabaseSync): Map<string, Enrichment> {
  ensureTable(db);
  const rows = db.prepare(`SELECT key, url, event FROM enrichments`).all() as any[];
  return new Map(rows.map(r => [r.key, { key: r.key, url: r.url, event: r.event ? JSON.parse(r.event) : null }]));
}

// The post may not name a state, but the event's own website often does ("Hartwell, GA 30643").
export const inArea = (e?: Enrichment) => !e?.event || !outOfArea(e.event);

// Posts win; the website only fills empty fields and adds dates the posts didn't mention.
export function applyEnrichment(lead: Lead, e?: Enrichment): Lead & { website?: string; filledFromWebsite: string[] } {
  if (!e?.event) return { ...lead, filledFromWebsite: [] };
  const filled: string[] = [];
  const out: any = { ...lead };
  for (const f of ['organizer', 'venueName', 'address', 'city', 'signupUrl', 'websiteUrl'] as const) {
    if (!out[f] && e.event[f]) { out[f] = e.event[f]; filled.push(f); }
  }
  const dates = lead.dates.map(d => ({ ...d })); // copies: don't edit the lead passed in
  const known = new Map(dates.filter(d => d.date).map(d => [d.date, d]));
  const extra = e.event.dates.filter(d => d.date && !known.has(d.date) && d.date >= today());
  for (const d of e.event.dates) {
    const k = d.date && known.get(d.date);
    if (k && !k.startTime && d.startTime) { Object.assign(k, { startTime: d.startTime, endTime: d.endTime }); filled.push(`times ${d.date}`); }
  }
  out.dates = dates;
  if (extra.length) { out.dates = [...dates, ...extra].sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9')); filled.push(`${extra.length} more dates`); }
  out.websiteUrl ??= e.url ?? undefined;
  return { ...out, website: e.url ?? undefined, filledFromWebsite: filled };
}

const RESULT = 'a[data-testid="result-title-a"]';

async function search(page: Page, q: string): Promise<string[]> {
  await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });
  const ok = await page.waitForSelector(RESULT, { timeout: 10000 }).catch(() => null);
  if (!ok) {
    const text = await page.locator('body').innerText();
    if (/bots use DuckDuckGo|challenge/i.test(text)) {
      console.log('  DuckDuckGo wants a human check: solve it in the browser window (waiting 2 minutes)');
      await page.waitForSelector(RESULT, { timeout: 120000 });
    } else return []; // genuinely no results
  }
  return (await page.$$eval(RESULT, as => as.map(a => (a as HTMLAnchorElement).href))).filter(u => /^https?:/.test(u) && !SKIP.test(u));
}

async function pageText(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500); // let script-built pages fill in
  return (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n').trim();
}

// The page must mention most of the market's name, so a search miss doesn't fill a lead with another event.
export function pageMatches(text: string, name: string, place?: string) {
  const want = [...nameTokens(name)], have = nameTokens(text);
  const nameOk = want.length > 0 && want.filter(w => have.has(w)).length / want.length >= 0.75;
  const placeWords = [...nameTokens(place ?? '')];
  return nameOk && (!placeWords.length || placeWords.some(w => have.has(w)));
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { all: { type: 'boolean', default: false }, redo: { type: 'boolean', default: false } } });
  const db = openDb();
  const done = loadEnrichments(db);
  const leads = groupMentions(loadMentions(db)).filter(l => (args.all || isUpcoming(l)) && (args.redo || !done.has(l.key)));
  const save = db.prepare(`INSERT OR REPLACE INTO enrichments (key, url, event, searched_at) VALUES (?, ?, ?, ?)`);
  const run = promisify(execFile);
  // Visible window with its own profile: DuckDuckGo challenges headless browsers on every search.
  const browser = await chromium.launchPersistentContext(DATA_DIR + 'search-profile', { channel: 'chrome', headless: false });
  const page = browser.pages()[0] ?? (await browser.newPage());
  console.log(`looking up ${leads.length} leads`);
  try {
    for (const [i, lead] of leads.entries()) {
      // No quotes: OCR'd names rarely match a site word for word. Venue and city narrow it to the right event.
      const venue = lead.venueName && !similarNames(lead.venueName, lead.marketName) ? lead.venueName : '';
      const query = [lead.marketName.replace(/[^\p{L}\p{N}&' ]/gu, ' '), venue, lead.city ?? 'NC'].filter(Boolean).join(' ');
      let found: Enrichment = { key: lead.key, url: null, event: null };
      try {
        const candidates = lead.websiteUrl ? [lead.websiteUrl.replace(/^(?!https?:)/, 'https://')] : [];
        candidates.push(...(await search(page, query)).slice(0, 5));
        for (const url of candidates) {
          const text = await pageText(page, url).catch(() => '');
          if (!pageMatches(text, lead.marketName, lead.city)) continue;
          const child = run(BIN, [], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
          child.child.stdin!.end(JSON.stringify({ pageText: text, postedAt: today() }));
          const events: Event[] = JSON.parse((await child).stdout).result.events;
          const event = events.find(e => similarNames(e.marketName, lead.marketName)) ?? null;
          if (event) { found = { key: lead.key, url, event }; break; }
        }
      } catch (e) {
        console.log(`  ${lead.marketName}: ${e}`); // recorded as not found; --redo retries
      }
      save.run(lead.key, found.url, found.event && JSON.stringify(found.event), Math.floor(Date.now() / 1000));
      const filled = applyEnrichment(lead, found).filledFromWebsite;
      console.log(`[${i + 1}/${leads.length}] ${lead.marketName}: ${found.url ? `${found.url} -> ${filled.join(', ') || 'nothing new'}` : 'no website found'}`);
      await page.waitForTimeout(2000 + Math.random() * 2000); // gentle on DuckDuckGo
    }
  } finally {
    await browser.close();
  }
}
