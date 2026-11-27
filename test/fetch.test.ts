import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { parseExport, mergeSources } from '../src/accounts.ts';
import { findPosts, findAccount } from '../src/instagram.ts';

test('parses both export shapes', () => {
  const followers = [{ string_list_data: [{ href: 'https://www.instagram.com/Triangle_Embroidery', value: 'Triangle_Embroidery' }] }];
  const following = { relationships_following: [{ title: 'christinesplates', string_list_data: [{ href: 'https://www.instagram.com/_u/christinesplates' }] }, { title: 'bad handle!' }] };
  assert.deepEqual(parseExport(followers, 'follower'), ['triangle_embroidery']);
  assert.deepEqual(parseExport(following, 'following'), ['christinesplates']);
  assert.throws(() => parseExport({}, 'follower'));
});

test('merges follower and following sources', () => {
  assert.deepEqual([...mergeSources(['a', 'b'], ['b', 'c'])], [['a', 'follower'], ['b', 'both'], ['c', 'following']]);
});

const media = (code: string, t: number, extra = {}) => ({
  code, taken_at: t, media_type: 1, user: { username: 'flyingpigcandyco' }, caption: { text: `cap ${code}` },
  image_versions2: { candidates: [{ width: 320, url: `small-${code}` }, { width: 1080, url: `big-${code}` }] }, ...extra,
});

test('finds posts anywhere in the page JSON, with carousels, video thumbnails and widest image', () => {
  const json = { data: { xdt_feed: { edges: [
    { node: media('photo', 200) },
    { node: media('carousel', 150, { media_type: 8, carousel_media: [media('c1', 0), media('c2', 0)] }) },
    { node: media('video', 120, { media_type: 2 }) },
    { node: media('someoneElse', 300, { user: { username: 'other' } }) },
  ] } } };
  const posts = findPosts(json, 'flyingpigcandyco');
  assert.deepEqual(posts.map(p => [p.shortcode, p.imageUrls, p.isVideo]), [
    ['photo', ['big-photo'], false],
    ['carousel', ['big-c1', 'big-c2'], false],
    ['video', ['big-video'], true],
  ]);
  assert.equal(posts[0].caption, 'cap photo');
  assert.equal(posts[0].url, 'https://www.instagram.com/p/photo/');
});

test('reads account type only on positive evidence', () => {
  const u = (o: object) => ({ data: { user: { username: 'Shop', ...o } } });
  assert.deepEqual(findAccount(u({ is_private: true }), 'shop'), { isPrivate: true });
  assert.deepEqual(findAccount(u({ is_private: false, account_type: 1 }), 'shop'), { isPrivate: false, isPersonal: true });
  assert.deepEqual(findAccount(u({ account_type: 2 }), 'shop'), { isPersonal: false });
  assert.deepEqual(findAccount(u({}), 'shop'), {});
  assert.deepEqual(findAccount(u({ is_private: true }), 'other'), {});
});

test('importing keeps an ignored status', async () => {
  const { importAccounts } = await import('../src/accounts.ts');
  const { openDb } = await import('../src/db.ts');
  const db: DatabaseSync = openDb(':memory:');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(tmpdir() + '/export-') + '/';
  writeFileSync(dir + 'following.json', JSON.stringify({ relationships_following: [{ title: 'little_bird_custom_gifts' }] }));
  importAccounts(db, dir);
  db.prepare(`UPDATE accounts SET status = 'ignored' WHERE handle = 'little_bird_custom_gifts'`).run();
  importAccounts(db, dir);
  assert.equal((db.prepare(`SELECT status FROM accounts WHERE handle = 'little_bird_custom_gifts'`).get() as any).status, 'ignored');
});
