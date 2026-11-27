import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEnrichment, pageMatches, inArea } from '../src/enrich.ts';
import type { Lead } from '../src/group.ts';

const lead: Lead = {
  key: 'k', marketName: 'Holl & Stone Fall Makers Market', city: 'Garner', confidence: 1, accounts: ['a'], mentions: [],
  dates: [{ asWritten: 'Saturday', date: '2099-09-12' }],
};

test('website fills only empty fields, adds times and later dates, never overrides posts', () => {
  const out = applyEnrichment(lead, {
    key: 'k', url: 'https://hollandstone.example/market',
    event: {
      marketName: 'Fall Makers Market', city: 'Raleigh', address: '920 Buffalo Rd', signupUrl: 'https://hollandstone.example/apply', confidence: 1,
      dates: [{ asWritten: 'Sep 12', date: '2099-09-12', startTime: '10:00', endTime: '17:00' }, { asWritten: 'Oct 3', date: '2099-10-03' }, { asWritten: 'old', date: '2000-01-01' }],
    },
  });
  assert.equal(out.city, 'Garner');
  assert.equal(out.address, '920 Buffalo Rd');
  assert.equal(out.websiteUrl, 'https://hollandstone.example/market');
  assert.deepEqual(out.dates.map(d => [d.date, d.startTime]), [['2099-09-12', '10:00'], ['2099-10-03', undefined]]);
  assert.deepEqual(out.filledFromWebsite, ['address', 'signupUrl', 'times 2099-09-12', '1 more dates']);
  assert.equal(lead.dates[0].startTime, undefined, 'input lead unchanged');
});

test('a page must mention most of the market name', () => {
  assert.ok(pageMatches('Welcome to the Holl and Stone Farms fall makers market!', 'Holl & Stone Fall Makers Market'));
  assert.ok(!pageMatches('Garner parks and recreation events calendar', 'Holl & Stone Fall Makers Market'));
});

test('a page in another town does not match', () => {
  assert.ok(pageMatches('Mebane Night Market, 200 N Third St, Mebane NC', 'Mebane Night Market', 'Mebane, NC'));
  assert.ok(!pageMatches('Fall Makers Market at the Asheville fairgrounds', 'Fall Makers Market', 'Garner'));
});

test('a website showing another state drops the lead', () => {
  assert.ok(!inArea({ key: 'k', url: 'u', event: { marketName: 'x', dates: [], confidence: 1, city: 'Hartwell, GA 30643, USA' } }));
  assert.ok(inArea({ key: 'k', url: 'u', event: { marketName: 'x', dates: [], confidence: 1, city: 'Raleigh, NC' } }));
  assert.ok(inArea(undefined));
});
