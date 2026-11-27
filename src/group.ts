// Groups event mentions from many posts and accounts into leads:
// - similar name in a compatible place (dates may differ: a monthly market becomes one lead with many dates), or
// - same date at the same street address (OCR often mangles names but not addresses).

export type EventDate = { asWritten: string; date: string | null; startTime?: string; endTime?: string };
export type Event = {
  marketName: string; organizer?: string; venueName?: string; address?: string; city?: string;
  dates: EventDate[]; signupUrl?: string; websiteUrl?: string; confidence: number;
};
export type Mention = { shortcode: string; handle: string; url: string; takenAt: number; event: Event };
export type Lead = {
  key: string; marketName: string; organizer?: string; venueName?: string; address?: string; city?: string;
  dates: EventDate[]; signupUrl?: string; websiteUrl?: string; confidence: number;
  accounts: string[]; mentions: Mention[];
};

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const STOP = new Set(['the', 'a', 'an', 'at', 'of', 'and', 'in', 'on', 'market', 'markets', 'mkt', 'fest', 'festival', 'fair', 'nc', 'downtown',
  'my', 'our', 'this', 'these', 'weekend', 'pm', 'am', 'event', 'events', 'pop', 'up', 'popup']);
// Time ranges like "10-2" or "5-9pm" become digit tokens; they say nothing about which market it is.
export const nameTokens = (s: string) =>
  new Set(s.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+(am|pm)?$/.test(w)));

export function similarNames(a: string, b: string) {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.size || !y.size) return false;
  if (letters(a) === letters(b)) return true; // "AutumnFest" vs "Autumn Fest"
  const shared = [...x].filter(w => y.has(w)).length;
  // One distinctive word ("Raleigh", "Farmers") is too generic to match anything but the same name.
  if (Math.min(x.size, y.size) === 1) return x.size === y.size && shared === 1;
  // "Mebane Night Market" inside "Mebane Downtown Holiday Night Market" counts; so does a half overlap.
  return shared === Math.min(x.size, y.size) || shared / new Set([...x, ...y]).size >= 0.5;
}

// "616 N First Ave" and "616 N. 1st Avenue" -> "616 n"; number plus first letter is enough on one date.
const street = (a?: string) => a?.toLowerCase().match(/^(\d+)\s+([a-z])/)?.slice(1).join(' ');

const datesOf = (e: Event) => new Set(e.dates.map(d => d.date).filter((d): d is string => !!d));

const placeTokens = (e: Event) => nameTokens(`${e.city ?? ''} ${e.venueName ?? ''}`);

function sameEvent(a: Event, b: Event) {
  const da = datesOf(a), db = datesOf(b);
  const shareDate = [...da].some(d => db.has(d));
  if (shareDate && street(a.address) && street(a.address) === street(b.address)) return true;
  if (!similarNames(a.marketName, b.marketName)) return false;
  const pa = placeTokens(a), pb = placeTokens(b);
  // Unknown place on either side can't rule it out; two known places must overlap ("Holiday Market" in two towns).
  return !pa.size || !pb.size || [...pa].some(w => pb.has(w));
}

const sameBusiness = (name: string, handle: string) => {
  const a = letters(name), b = letters(handle);
  return a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a));
};

// Most common non-empty value; ties go to the longest (usually the least truncated).
function pick(values: (string | undefined)[]) {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
}

// A state other than the Carolinas written in the place, or the model's placeholder address.
const STATES = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|ND|OH|OK|OR|PA|RI|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b(?:\s+\d{5}(?:-\d{4})?)?(?:,?\s*USA)?\s*$/;
export const outOfArea = (e: Event) =>
  [e.city, e.address].some(p => p && STATES.test(p.trim())) || /\b123 main st/i.test(e.address ?? '') || /springfield/i.test(e.city ?? '');

// Single-business posts (bingo, a bakery's pickup day, Santa photos) rarely name a market; real ones usually do.
const MARKET_WORD = /market|mkt|fair|fest|bazaar|maker|craft|vendor|pop.?up|artisan|expo|show|rodeo|flea|vintage/i;
const looksLikeMarket = (l: Lead) => MARKET_WORD.test(l.marketName) || l.accounts.length >= 2 || l.confidence >= 1;

export function groupMentions(mentions: Mention[], minConfidence = 0.3): Lead[] {
  // Drop names with nothing distinctive ("my markets", "10-2 market") and the posting account's own name.
  const ms = mentions.filter(m => m.event.confidence >= minConfidence && nameTokens(m.event.marketName ?? '').size > 0 && !sameBusiness(m.event.marketName, m.handle) && !outOfArea(m.event));
  // Union-find over mentions.
  const parent = ms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++)
      if (sameEvent(ms[i].event, ms[j].event)) parent[find(i)] = find(j);

  const groups = new Map<number, Mention[]>();
  ms.forEach((m, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), m]));

  return [...groups.values()]
    .map(g => {
      const ev = g.map(m => m.event);
      const byDate = new Map<string, EventDate>();
      for (const d of ev.flatMap(e => e.dates)) {
        const k = d.date ?? d.asWritten;
        const prev = byDate.get(k);
        if (!prev || (!prev.startTime && d.startTime)) byDate.set(k, d); // keep the copy that has times
      }
      const dates = [...byDate.values()].sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9'));
      const marketName = pick(ev.map(e => e.marketName))!;
      return {
        // Stable across runs as new dates arrive; used to remember website searches and what was sent.
        key: [...nameTokens(marketName), ...nameTokens(pick(ev.map(e => e.city)) ?? '')].join('-'),
        marketName,
        // The posting account is a vendor, not the organizer, whatever the model says.
        organizer: pick(g.map(m => m.event.organizer && !sameBusiness(m.event.organizer, m.handle) ? m.event.organizer : undefined)),
        venueName: pick(ev.map(e => e.venueName)),
        address: pick(ev.map(e => e.address)),
        city: pick(ev.map(e => e.city)),
        dates,
        signupUrl: pick(ev.map(e => e.signupUrl)),
        websiteUrl: pick(ev.map(e => e.websiteUrl)),
        confidence: Math.max(...ev.map(e => e.confidence)),
        accounts: [...new Set(g.map(m => m.handle))],
        mentions: g,
      };
    })
    .filter(looksLikeMarket)
    .sort((a, b) => b.accounts.length - a.accounts.length || b.mentions.length - a.mentions.length || b.confidence - a.confidence);
}
