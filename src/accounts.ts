import { readFileSync, existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

type Source = 'follower' | 'following' | 'both';

// Instagram export: followers_N.json is an array; following.json wraps one under relationships_following,
// and keeps the handle in `title` instead of string_list_data.value.
export function parseExport(json: unknown, kind: 'follower' | 'following'): string[] {
  const list = kind === 'following' ? (json as any)?.relationships_following : json;
  if (!Array.isArray(list)) throw new Error(`unexpected ${kind} export shape`);
  return list
    .map((e: any) => e.string_list_data?.[0]?.value || e.title || e.string_list_data?.[0]?.href?.split('/').filter(Boolean).pop())
    .filter((h: unknown): h is string => typeof h === 'string' && /^[\w.]+$/.test(h))
    .map((h: string) => h.toLowerCase());
}

export function mergeSources(followers: string[], following: string[]): Map<string, Source> {
  const out = new Map<string, Source>();
  for (const h of followers) out.set(h, 'follower');
  for (const h of following) out.set(h, out.has(h) ? 'both' : 'following');
  return out;
}

// Adds new handles from the export files in `dir`; never touches existing rows' status.
export function importAccounts(db: DatabaseSync, dir: string): number {
  const read = (f: string) => JSON.parse(readFileSync(dir + f, 'utf8'));
  const followerFiles = ['followers_1.json', 'followers_2.json', 'followers_3.json'].filter(f => existsSync(dir + f));
  const followers = followerFiles.flatMap(f => parseExport(read(f), 'follower'));
  const following = existsSync(dir + 'following.json') ? parseExport(read('following.json'), 'following') : [];
  const insert = db.prepare(
    `INSERT INTO accounts (handle, source) VALUES (?, ?)
     ON CONFLICT(handle) DO UPDATE SET source = excluded.source`,
  );
  const merged = mergeSources(followers, following);
  for (const [h, s] of merged) insert.run(h, s);
  return merged.size;
}
