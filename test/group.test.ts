import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupMentions, similarNames, outOfArea, type Event } from '../src/group.ts';

const ev = (marketName: string, dates: string[], extra: Partial<Event> = {}): Event =>
  ({ marketName, dates: dates.map(date => ({ asWritten: date, date })), confidence: 0.9, ...extra });
let n = 0;
const m = (handle: string, event: Event) => ({ shortcode: `p${n++}`, handle, url: '', takenAt: 0, event });

test('name similarity ignores filler words and allows a shorter name inside a longer one', () => {
  assert.ok(similarNames('Mebane Night Market', 'Downtown Mebane Holiday Night Market'));
  assert.ok(similarNames('OAK CITY MAKERS MKT', 'Oak City Makers Market'));
  assert.ok(!similarNames('Fall Makers Market', 'Holiday Makers Market'));
  assert.ok(!similarNames('Market', 'Festival'));
  assert.ok(similarNames('Mebane AutumnFest', 'Mebane Autumn Fest'));
});

test('groups across accounts, merges dates and keeps the copy with times', () => {
  const leads = groupMentions([
    m('a', ev('Mebane Night Market', ['2026-11-13'], { city: 'Mebane, NC' })),
    m('b', { ...ev('Downtown Mebane Holiday Night Market', []), dates: [{ asWritten: 'Fri', date: '2026-11-13', startTime: '17:00', endTime: '21:00' }], city: 'Mebane' }),
    m('a', ev('MEBANE NIGHT MARKET', ['2026-12-11'], { city: 'Mebane' })),
    m('c', ev('Cary Farmers Fall Festival', ['2026-09-19'])),
  ]);
  assert.equal(leads.length, 2);
  assert.deepEqual(leads[0].accounts, ['a', 'b']);
  assert.deepEqual(leads[0].dates.map(d => [d.date, d.startTime]), [['2026-11-13', '17:00'], ['2026-12-11', undefined]]);
});

test('same date and street address merges different names; same name in different towns does not', () => {
  const leads = groupMentions([
    m('a', ev('FALL MAKERS MARKET', ['2026-11-07'], { address: '616 N FIRST AVE, KNIGHTDALE' })),
    m('b', ev('Oak City Makers Mkt', ['2026-11-07'], { address: '616 N. 1st Ave' })),
    m('a', ev('Holiday Market', ['2026-12-06'], { city: 'Youngsville' })),
    m('b', ev('Holiday Market', ['2026-12-06'], { city: 'Wake Forest' })),
  ]);
  assert.deepEqual(leads.map(l => l.mentions.length), [2, 1, 1]);
});

test('drops low-confidence mentions', () => {
  assert.equal(groupMentions([m('a', ev('Small Business Saturday', ['2026-11-29'], { confidence: 0 }))]).length, 0);
});

test('the posting account is never the organizer', () => {
  const [lead] = groupMentions([m('flyingpigcandyco', ev('Fall Market', ['2026-11-07'], { organizer: 'Flying Pig Candy Co.' }))]);
  assert.equal(lead.organizer, undefined);
});

test('generic one-word names only match the same name', () => {
  assert.ok(!similarNames('the raleigh market', 'Raleigh Night Market'));
  assert.ok(!similarNames('Farmers Market', 'Cary Farmers Fall Festival'));
  assert.ok(similarNames('Farmers Market', 'farmers markets'));
});

test('drops names with nothing distinctive and the poster naming itself', () => {
  const leads = groupMentions([
    m('mollymousemakes', ev('mollymousemakes', ['2099-01-01'])),
    m('a', ev('my markets', ['2099-01-01'])),
    m('a', ev('10-2 market', ['2099-01-01'])),
    m('a', ev('Makrs Holiday Fest', ['2099-11-28'])),
  ]);
  assert.deepEqual(leads.map(l => l.marketName), ['Makrs Holiday Fest']);
});

test('drops places outside the Carolinas and the placeholder address', () => {
  assert.ok(outOfArea(ev('Farmers markets', [], { address: '123 Main Street', city: 'Springfield, CA' })));
  assert.ok(outOfArea(ev('Holiday Market', [], { city: 'Hartwell, GA' })));
  assert.ok(!outOfArea(ev('Holiday Market', [], { city: 'Raleigh, NC', address: '616 N First Ave, Knightdale, NC 27545' })));
  assert.ok(!outOfArea(ev('Holiday Market', [], { city: 'Greenville, SC' })));
  assert.ok(!outOfArea(ev('Holiday Market', [], { address: '1911 Sego Ct, Edit Beer CO', city: 'Wake Forest' })), 'CO without a comma is a company');
  assert.ok(outOfArea(ev('Holiday Market', [], { city: 'Hartwell, GA 30643, USA' })));
});

test('a lead without a market word needs a second account or full confidence', () => {
  const leads = groupMentions([
    m('a', ev('music bingo', ['2099-02-11'], { confidence: 0.8 })),
    m('a', ev('The Christmas Corral', ['2099-12-05'], { confidence: 1 })),
    m('a', ev('downtown tree lighting', ['2099-11-20'], { confidence: 0.9 })),
    m('b', ev('downtown tree lighting', ['2099-11-20'], { confidence: 0.9 })),
    m('a', ev('Mistletoe Market', ['2099-11-14'], { confidence: 0.6 })),
  ]);
  assert.deepEqual(leads.map(l => l.marketName).sort(), ['Mistletoe Market', 'The Christmas Corral', 'downtown tree lighting']);
});

test('drops a name that is only the city', () => {
  const leads = groupMentions([
    m('dssolvr', ev('AVL and DRM', ['2099-11-27'], { city: 'AVL', confidence: 1 })),
    m('dssolvr', ev('AVL and DRM', ['2099-11-20'], { city: 'AVL and DRM', confidence: 1 })),
    m('a', ev('Durham Holiday Market', ['2099-12-05'], { city: 'Durham, NC' })),
  ]);
  assert.deepEqual(leads.map(l => l.marketName), ['Durham Holiday Market']);
});
