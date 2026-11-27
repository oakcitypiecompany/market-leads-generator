// Prints the current leads, grouped from every extracted post.
// Usage: npm run leads [-- --all]   (default: only leads with a date today or later, or no date)
import { parseArgs } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from './db.ts';
import { groupMentions, type Mention, type Lead } from './group.ts';
import { loadEnrichments, applyEnrichment, inArea } from './enrich.ts';

export function loadMentions(db: DatabaseSync): Mention[] {
  const rows = db.prepare(`SELECT shortcode, handle, url, taken_at, result FROM posts WHERE status = 'extracted'`).all() as any[];
  return rows.flatMap(r =>
    JSON.parse(r.result).result.events.map((event: any) => ({ shortcode: r.shortcode, handle: r.handle, url: r.url, takenAt: r.taken_at, event })),
  );
}

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
// Undated leads are kept only with a street address to look them up by; the rest are guides and food-truck lists.
export const isUpcoming = (l: Lead) =>
  l.dates.some(d => d.date) ? l.dates.some(d => d.date && d.date >= today()) : /^\s*\d+\s+[a-z]/i.test(l.address ?? '');

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { all: { type: 'boolean', default: false } } });
  const db = openDb();
  const sites = loadEnrichments(db);
  const leads = groupMentions(loadMentions(db)).filter(l => (args.all || isUpcoming(l)) && inArea(sites.get(l.key))).map(l => applyEnrichment(l, sites.get(l.key)));
  for (const l of leads) {
    const when = l.dates.map(d => `${d.date ?? `"${d.asWritten}"`}${d.startTime ? ` ${d.startTime}-${d.endTime ?? ''}` : ''}`).join(', ');
    console.log(`\n${l.marketName}  [${l.accounts.length} account(s), ${l.mentions.length} mention(s), conf ${l.confidence}]`);
    console.log(`  when:  ${when || '(no date)'}`);
    console.log(`  where: ${[l.venueName, l.address, l.city].filter(Boolean).join(' | ') || '(unknown)'}`);
    if (l.organizer || l.signupUrl || l.websiteUrl) console.log(`  more:  ${[l.organizer && `org ${l.organizer}`, l.signupUrl, l.websiteUrl].filter(Boolean).join(' | ')}`);
    if (l.website) console.log(`  site:  ${l.website}${l.filledFromWebsite.length ? ` (filled: ${l.filledFromWebsite.join(', ')})` : ''}`);
    console.log(`  posts: ${l.mentions.map(m => m.url).join(' ')}`);
  }
  console.log(`\n${leads.length} leads`);
}
