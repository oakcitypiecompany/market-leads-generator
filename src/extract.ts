// Runs the on-device extractor on every post fetch.ts saved, and stores what it found.
// Usage: npm run extract [-- --retry]   (--retry also reruns posts that errored)
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { openDb, easternDay } from './db.ts';

const BIN = new URL('../extractor/.build/release/extract', import.meta.url).pathname;
if (!existsSync(BIN)) throw new Error('Build the extractor first: cd extractor && swift build -c release');

const { values: args } = parseArgs({ options: { retry: { type: 'boolean', default: false } } });
const run = promisify(execFile);
const db = openDb();
const posts = db
  .prepare(`SELECT shortcode, caption, taken_at, images FROM posts WHERE status IN (${args.retry ? "'new','error'" : "'new'"}) ORDER BY taken_at`)
  .all() as { shortcode: string; caption: string; taken_at: number; images: string }[];
const save = db.prepare(`UPDATE posts SET status = ?, result = ? WHERE shortcode = ?`);

let found = 0, skipped = 0, failed = 0;
for (const [i, p] of posts.entries()) {
  const job = JSON.stringify({ caption: p.caption, postedAt: easternDay(p.taken_at), images: JSON.parse(p.images) });
  try {
    // The on-device model very occasionally hangs; give up on that post and keep going (--retry picks it up).
    const child = run(BIN, [], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
    child.child.stdin!.end(job);
    const out = JSON.parse((await child).stdout);
    const status = out.skipped ? 'skipped' : 'extracted';
    save.run(status, JSON.stringify(out), p.shortcode);
    if (out.skipped) skipped++; else found += out.result.events.length;
    console.log(`[${i + 1}/${posts.length}] ${p.shortcode}: ${out.skipped ? 'skipped by pre-filter' : `${out.result.events.length} events`}`);
  } catch (e: any) {
    failed++;
    const why = e.killed ? 'timed out after 2 minutes' : (e.stderr || e).toString().trim();
    save.run('error', JSON.stringify({ error: why }), p.shortcode);
    console.log(`[${i + 1}/${posts.length}] ${p.shortcode}: error ${why}`);
  }
}
console.log(`${posts.length} posts: ${found} events found, ${skipped} skipped, ${failed} errors`);
