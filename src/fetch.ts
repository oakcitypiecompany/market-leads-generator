// Visits each watched account like a person would, saves new posts and their images to data/.
// Usage: npm run fetch [-- --handle name] [--days 60] [--max 50] [--headless] [--debug]
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { openDb, DATA_DIR } from './db.ts';
import { importAccounts } from './accounts.ts';
import { findPosts, findAccount, type Post, type AccountInfo } from './instagram.ts';
import { openBrowser } from './browser.ts';

const { values: args } = parseArgs({
  options: {
    handle: { type: 'string' },
    days: { type: 'string', default: '60' }, // look-back for accounts never checked (or with --handle)
    max: { type: 'string' }, // accounts per run; the rest resume next run
    headless: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false }, // save captured JSON to data/debug/<handle>.json
  },
});

// Two runs share one Chrome profile and close each other's browser, so only one may run at a time.
const LOCK = DATA_DIR + 'fetch.lock';
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8'));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch {}
  if (alive) throw new Error(`Another fetch is already running (process ${pid}).`);
}
writeFileSync(LOCK, String(process.pid));
process.on('exit', () => rmSync(LOCK, { force: true }));
process.on('SIGTERM', () => process.exit(143));
process.on('SIGINT', () => process.exit(130));

const db = openDb();
const imported = importAccounts(db, new URL('../', import.meta.url).pathname);
const lookBack = Math.floor(Date.now() / 1000) - Number(args.days) * 86400;

let queue: { handle: string; last_checked: number | null }[];
if (args.handle) {
  const handle = args.handle.toLowerCase();
  db.prepare(`INSERT OR IGNORE INTO accounts (handle, source) VALUES (?, 'manual')`).run(handle);
  queue = [{ handle, last_checked: null }];
} else {
  queue = db
    .prepare(`SELECT handle, last_checked FROM accounts WHERE status = 'watched' ORDER BY last_checked IS NOT NULL, last_checked`)
    .all() as typeof queue;
  if (args.max) queue = queue.slice(0, Number(args.max));
}
console.log(`${imported} accounts in export, checking ${queue.length}`);

const imgDir = DATA_DIR + 'images/';
mkdirSync(imgDir, { recursive: true });
const insertPost = db.prepare(
  `INSERT OR IGNORE INTO posts (shortcode, handle, url, caption, taken_at, is_video, image_urls, images)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const setAccount = db.prepare(`UPDATE accounts SET status = ?, last_checked = ?, error = ? WHERE handle = ?`);
const setError = db.prepare(`UPDATE accounts SET error = ? WHERE handle = ?`);
const wait = (min: number, spread: number) => new Promise(r => setTimeout(r, min + Math.random() * spread));
const LOGIN_MSG = 'Instagram wants a login or check. Run `npm run login`, then fetch again.';

class StopRun extends Error {}

// Images are fetched from inside the profile page, like the page loads them itself: Playwright's separate
// request client got ~40s per image from Instagram's servers. Three tries with a pause before giving up.
async function download(url: string, what: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const r = await page.evaluate(async u => {
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return { status: res.status };
        const bytes = new Uint8Array(await res.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { status: 200, b64: btoa(bin) };
      } catch (e) {
        return { status: 0, error: String(e) };
      }
    }, url);
    if (r.b64) return Buffer.from(r.b64, 'base64');
    const why = `${what}: ${r.status ? `HTTP ${r.status}` : r.error}`;
    if (attempt === 3 || (r.status >= 400 && r.status < 500 && r.status !== 429)) throw new Error(why);
    await wait(3000 * attempt, 2000);
  }
}

const ctx = await openBrowser(args.headless);
const page = ctx.pages()[0] ?? (await ctx.newPage());

// Everything JSON the page receives while we're on a profile.
let captured: unknown[] = [];
let rateLimited = false;
page.on('response', async res => {
  if (res.status() === 429) rateLimited = true;
  if (!(res.headers()['content-type'] ?? '').includes('json') && !res.url().includes('/graphql')) return;
  try {
    captured.push(JSON.parse((await res.text()).replace(/^for \(;;\);/, '')));
  } catch {} // non-JSON or body already gone; nothing to read
});

async function collect(handle: string, since: number) {
  captured = [];
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded' });
  if (/\/accounts\/login|\/challenge/.test(page.url())) throw new StopRun(LOGIN_MSG);
  await wait(3000, 2000);
  // First posts are often embedded in the HTML rather than fetched.
  for (const text of await page.$$eval('script[type="application/json"]', els => els.map(e => e.textContent ?? ''))) {
    try { captured.push(JSON.parse(text)); } catch {}
  }
  const posts = new Map<string, Post>();
  let account: AccountInfo = {};
  const absorb = () => {
    for (const json of captured) {
      for (const p of findPosts(json, handle)) posts.set(p.shortcode, p);
      account = { ...account, ...findAccount(json, handle) };
    }
  };
  absorb();
  // Scroll for older posts until we pass the cutoff or nothing new loads.
  for (let i = 0; i < 10 && posts.size; i++) {
    const oldest = Math.min(...[...posts.values()].map(p => p.takenAt));
    if (oldest <= since || rateLimited) break;
    const before = posts.size;
    await page.mouse.wheel(0, 4000);
    await wait(2500, 1500);
    absorb();
    if (posts.size === before) break;
  }
  if (rateLimited) throw new StopRun('Instagram rate limit hit. Progress is saved; try again in a few hours.');
  if (args.debug) {
    mkdirSync(DATA_DIR + 'debug', { recursive: true });
    writeFileSync(`${DATA_DIR}debug/${handle}.json`, JSON.stringify({ url: page.url(), captured }, null, 1));
  }
  const privateText = await page.getByText('This account is private').count();
  return { posts: [...posts.values()], account, isPrivate: account.isPrivate ?? privateText > 0, notFound: (await page.getByText("Sorry, this page isn't available").count()) > 0 };
}

let saved = 0;
try {
  for (const [i, { handle, last_checked }] of queue.entries()) {
    const startedAt = Math.floor(Date.now() / 1000);
    const since = args.handle ? lookBack : (last_checked ?? lookBack);
    try {
      const c = await collect(handle, since);
      const status = c.notFound ? 'missing' : c.isPrivate ? 'private' : c.account.isPersonal ? 'personal' : 'watched';
      if (status === 'watched' && !c.posts.length && c.account.isPrivate === undefined)
        throw new Error('no posts or account data found on the page; rerun with --debug');
      const fresh = status === 'watched' ? c.posts.filter(p => p.takenAt > since) : [];
      for (const post of fresh) {
        const images: string[] = [];
        for (const [n, url] of post.imageUrls.entries()) {
          const file = `${imgDir}${post.shortcode}_${n}.jpg`;
          writeFileSync(file, await download(url, `image ${n} of ${post.shortcode}`));
          images.push(file);
        }
        const r = insertPost.run(post.shortcode, handle, post.url, post.caption, post.takenAt, post.isVideo ? 1 : 0, JSON.stringify(post.imageUrls), JSON.stringify(images));
        saved += Number(r.changes);
      }
      setAccount.run(status, startedAt, null, handle);
      console.log(`[${i + 1}/${queue.length}] ${handle}: ${status}, ${fresh.length} posts in window (${c.posts.length} seen)`);
    } catch (e) {
      if (e instanceof StopRun) throw e;
      setError.run(String(e), handle); // last_checked stays, so this account is retried next run
      console.log(`[${i + 1}/${queue.length}] ${handle}: error ${e}`);
    }
    if (i < queue.length - 1) await wait(8000, 7000);
  }
} catch (e) {
  if (!(e instanceof StopRun)) throw e;
  console.log(`Stopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  await ctx.close();
  console.log(`${saved} posts saved`);
}
