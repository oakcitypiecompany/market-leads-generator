// Sends upcoming leads to Carolina Market Roundup's Leads tab.
// Usage: npm run send [-- --dry-run]
// Needs ROUNDUP_URL and LEADS_API_KEY in .env (see .env.example).
import { parseArgs } from 'node:util';
import { openDb, easternDay } from './db.ts';
import { groupMentions, type Lead } from './group.ts';
import { loadMentions, isUpcoming } from './leads.ts';
import { loadEnrichments, applyEnrichment, inArea } from './enrich.ts';

// "makersmarketnc.com/apply" -> "https://makersmarketnc.com/apply"; anything else unusable -> null.
export function cleanUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return url.hostname.includes('.') && !url.username ? url.href : null;
  } catch {
    return null;
  }
}

const text = (s: string | undefined, max: number) => (s?.trim() ? s.trim().slice(0, max) : null);
const time = (t?: string) => (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);

// Matches the roundup's leadInputSchema.
export function toPayload(l: Lead & { website?: string; filledFromWebsite: string[] }) {
  const mentions = [...new Map(l.mentions.map(m => [m.url, m])).values()].slice(0, 50);
  return {
    key: l.key.slice(0, 200) || l.marketName.toLowerCase(),
    name: l.marketName.trim().slice(0, 120),
    organizer: text(l.organizer, 120),
    venueName: text(l.venueName, 120),
    address: text(l.address, 200),
    city: text(l.city, 80),
    signupUrl: cleanUrl(l.signupUrl),
    websiteUrl: cleanUrl(l.websiteUrl),
    website: cleanUrl(l.website),
    dates: l.dates.slice(0, 60).map(d => ({ date: d.date, asWritten: d.asWritten.slice(0, 120), startTime: time(d.startTime), endTime: time(d.endTime) })),
    mentions: mentions.map(m => ({ handle: m.handle, url: m.url, postedAt: easternDay(m.takenAt) })),
    accountCount: l.accounts.length,
    confidence: Math.min(1, Math.max(0, l.confidence)),
    filledFromWebsite: l.filledFromWebsite.slice(0, 20),
  };
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  const db = openDb();
  const sites = loadEnrichments(db);
  const leads = groupMentions(loadMentions(db))
    .filter(l => isUpcoming(l) && inArea(sites.get(l.key)))
    .map(l => toPayload(applyEnrichment(l, sites.get(l.key))))
    .filter(l => l.name.length >= 2);
  if (args['dry-run']) {
    console.log(JSON.stringify(leads, null, 2));
    console.log(`${leads.length} leads would be sent`);
  } else {
    const { ROUNDUP_URL, LEADS_API_KEY } = process.env;
    if (!ROUNDUP_URL || !LEADS_API_KEY) throw new Error('Set ROUNDUP_URL and LEADS_API_KEY in .env (copy .env.example)');
    for (let i = 0; i < leads.length; i += 25) {
      const res = await fetch(new URL('/api/leads', ROUNDUP_URL), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${LEADS_API_KEY}` },
        body: JSON.stringify({ leads: leads.slice(i, i + 25) }),
      });
      if (!res.ok) throw new Error(`Roundup refused the leads (${res.status}): ${await res.text()}`);
    }
    console.log(`${leads.length} leads sent to ${ROUNDUP_URL}`);
  }
}
