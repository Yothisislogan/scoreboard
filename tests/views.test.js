import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conferenceIdFromView, describeConference, nflDivisionOf } from '../assets/js/conferences.js';
import { normalizeScoreboard } from '../assets/js/normalize.js';
import { buildNav, isValidView, navViews, viewPredicate, viewTitle } from '../assets/js/views.js';
import { fixture } from './helpers.js';

test('college FBS nav: Top 25, then conferences grouped by tier', () => {
  const nav = buildNav('college');
  assert.equal(nav.division, 'fbs');
  assert.deepEqual(
    nav.items.map((item) => item.view),
    ['all', 'favorites', 'top25', 'ranked'],
  );
  assert.deepEqual(
    nav.groups.map((group) => [group.view, group.label, group.children.map((c) => c.label)]),
    [
      ['power-4', 'Power 4', ['SEC', 'Big Ten', 'Big 12', 'ACC']],
      ['group-of-6', 'Group of 6', ['American', 'Conference USA', 'MAC', 'Mountain West', 'Pac-12', 'Sun Belt']],
      ['independents', 'Independents', []],
    ],
  );
  assert.equal(navViews(nav).length, 4 + 3 + 10);
});

test('college FCS nav lists the conferences found in the data', () => {
  const { games } = normalizeScoreboard(fixture('fcs-scoreboard.json'), { league: 'college', division: 'fcs' });
  const names = { 20: { name: 'Big Sky' }, 21: { name: 'MVFC' } };
  const nav = buildNav('college', { division: 'fcs', games, conference: (id) => describeConference(id, names) });
  assert.equal(nav.division, 'fcs');
  assert.deepEqual(
    nav.groups[0].children.map((child) => [child.view, child.label]),
    [
      ['conf-20', 'Big Sky'],
      ['conf-48', 'Conference 48'],
      ['conf-21', 'MVFC'],
    ],
  );
});

test('NFL nav: conferences with their divisions', () => {
  const nav = buildNav('nfl');
  assert.equal(nav.division, undefined);
  assert.deepEqual(
    nav.groups.map((group) => [group.view, group.children.map((c) => c.fullLabel)]),
    [
      ['afc', ['AFC East', 'AFC North', 'AFC South', 'AFC West']],
      ['nfc', ['NFC East', 'NFC North', 'NFC South', 'NFC West']],
    ],
  );
  assert.equal(nav.groups[0].children[0].label, 'East');
});

test('view validity depends on the league', () => {
  assert.ok(isValidView('sec', 'college'));
  assert.ok(isValidView('conf-20', 'college'));
  assert.ok(isValidView('power-4', 'college'));
  assert.ok(isValidView('afc-west', 'nfl'));
  assert.ok(isValidView('favorites', 'nfl'));
  assert.ok(!isValidView('top25', 'nfl'));
  assert.ok(!isValidView('sec', 'nfl'));
  assert.ok(!isValidView('afc', 'college'));
  assert.ok(!isValidView('nonsense', 'college'));
  assert.equal(viewPredicate('bogus', { league: 'college' }), null);
});

test('view titles', () => {
  assert.equal(viewTitle('all', 'nfl'), 'All games');
  assert.equal(viewTitle('top25', 'college'), 'Top 25');
  assert.equal(viewTitle('big-ten', 'college'), 'Big Ten');
  assert.equal(viewTitle('group-of-6', 'college'), 'Group of 6');
  assert.equal(viewTitle('independents', 'college'), 'FBS Independents');
  assert.equal(viewTitle('nfc-north', 'nfl'), 'NFC North');
  assert.equal(viewTitle('conf-20', 'college', (id) => describeConference(id, { 20: { name: 'Big Sky' } })), 'Big Sky');
  assert.equal(viewTitle('conf-99', 'college'), 'Conference 99');
});

test('conference helpers', () => {
  assert.equal(conferenceIdFromView('sec'), '8');
  assert.equal(conferenceIdFromView('conf-81'), '81');
  assert.equal(conferenceIdFromView('top25'), null);
  assert.equal(describeConference('8').name, 'SEC');
  assert.equal(describeConference(null), null);
  assert.deepEqual(describeConference('20', { 20: { name: 'Big Sky', fullName: 'Big Sky Conference' } }), {
    id: '20',
    slug: 'conf-20',
    name: 'Big Sky',
    fullName: 'Big Sky Conference',
    tier: 'other',
  });
});

test('NFL divisions resolve by abbreviation, alias or ESPN id', () => {
  assert.equal(nflDivisionOf({ abbreviation: 'KC' }).slug, 'afc-west');
  assert.equal(nflDivisionOf({ abbreviation: 'WAS' }).slug, 'nfc-east');
  assert.equal(nflDivisionOf({ abbreviation: '???', id: '33' }).slug, 'afc-north');
  assert.equal(nflDivisionOf({ abbreviation: 'AFC' }), null);
});
