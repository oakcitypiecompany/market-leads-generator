import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, toPayload } from '../src/send.ts';

test('cleans URLs the model wrote without a scheme, drops unusable ones', () => {
  assert.equal(cleanUrl('makersmarketnc.com/apply'), 'https://makersmarketnc.com/apply');
  assert.equal(cleanUrl('https://x.example/a'), 'https://x.example/a');
  assert.equal(cleanUrl('not specified'), null);
  assert.equal(cleanUrl('javascript:alert(1)'), null);
  assert.equal(cleanUrl(undefined), null);
});

test('builds the payload the roundup expects', () => {
  const p = toPayload({
    key: 'mebane-night', marketName: ' Mebane Night Market ', city: 'Mebane', confidence: 1.2, accounts: ['a', 'b'], filledFromWebsite: [],
    dates: [{ asWritten: 'Fri', date: '2099-11-13', startTime: '17:00', endTime: '5-9pm' }],
    mentions: [
      { shortcode: 'x', handle: 'a', url: 'https://www.instagram.com/p/x/', takenAt: 1795000000, event: {} as any },
      { shortcode: 'x', handle: 'a', url: 'https://www.instagram.com/p/x/', takenAt: 1795000000, event: {} as any },
    ],
  });
  assert.equal(p.name, 'Mebane Night Market');
  assert.equal(p.confidence, 1);
  assert.equal(p.accountCount, 2);
  assert.deepEqual(p.dates, [{ date: '2099-11-13', asWritten: 'Fri', startTime: '17:00', endTime: null }]);
  assert.equal(p.mentions.length, 1, 'same post mentioning two events is listed once');
  assert.match(p.mentions[0].postedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p.organizer, null);
});
