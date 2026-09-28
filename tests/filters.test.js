import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSections,
  computeFacets,
  createQueryMatcher,
  filterGames,
  indexGamesByTeam,
  matchupScore,
  normalizeText,
  sortGames,
  statusBucket,
} from '../assets/js/filters.js';
import { defaultPrefs } from '../assets/js/state.js';
import { buildNav, navViews } from '../assets/js/views.js';
import { collegeGames, makeContext, nflGames } from './helpers.js';

const ids = (games) => games.map((game) => game.id.slice(-2));
const prefs = (league, patch = {}) => ({ ...defaultPrefs(league), ...patch });

test('status buckets', () => {
  const counts = { live: 0, upcoming: 0, final: 0 };
  for (const game of collegeGames()) counts[statusBucket(game)] += 1;
  // Seven games in progress, eleven still to play, twelve done (one postponed).
  assert.deepEqual(counts, { live: 7, upcoming: 11, final: 12 });
});

test('search: phrases stay within one team', () => {
  const games = collegeGames();
  const find = (query) => ids(games.filter(createQueryMatcher(query)));
  assert.deepEqual(find('ohio state'), ['05']);
  assert.deepEqual(find('Georgia vs Alabama'), ['12']);
  assert.deepEqual(find('UGA @ ALA'), ['12']);
  assert.deepEqual(find('alabama, georgia'), ['12']);
  assert.deepEqual(find('san jose'), ['26'], 'accents are ignored');
  assert.deepEqual(find('hawaii'), ['26'], 'apostrophes are ignored');
  assert.deepEqual(find('texas a&m'), ['11']);
  assert.deepEqual(find('texas am'), ['11']);
  assert.deepEqual(find('crimson tide'), ['12'], 'mascots match');
  assert.deepEqual(find('farmageddon'), ['06'], 'game notes match');
  assert.equal(find('').length, 30);
  assert.deepEqual(find('zzzz'), []);
  assert.equal(normalizeText('  San José  St. '), 'san jose st');
});

test('views, status and network filters combine', () => {
  const games = collegeGames();
  const ctx = makeContext('college');
  const run = (patch) => ids(filterGames(games, prefs('college', patch), ctx));
  assert.equal(run({ view: 'top25' }).length, 19);
  assert.deepEqual(run({ view: 'ranked' }).sort(), ['12', '13', '19', '24']);
  assert.deepEqual(run({ view: 'sec' }).sort(), ['04', '11', '12', '19', '24']);
  assert.equal(run({ view: 'power-4' }).length, 19);
  assert.equal(run({ view: 'group-of-6' }).length, 11);
  assert.deepEqual(run({ view: 'independents' }), ['22']);
  assert.deepEqual(run({ view: 'sec', status: 'live' }), ['12']);
  assert.deepEqual(run({ network: 'ABC' }).sort(), ['12', '19']);
  assert.deepEqual(run({ view: 'mountain-west', query: 'air force' }), ['27']);
});

test('favorites view includes starred games and followed teams', () => {
  const games = collegeGames();
  const ctx = makeContext('college', { games: new Set(['401800019']), teams: new Set(['college:194']) });
  const favorites = filterGames(games, prefs('college', { view: 'favorites' }), ctx);
  assert.deepEqual(ids(favorites).sort(), ['05', '19']);
});

test('facet counts apply every filter except their own', () => {
  const games = collegeGames();
  const ctx = makeContext('college');
  const views = navViews(buildNav('college'));
  const facets = computeFacets(games, prefs('college', { view: 'sec' }), ctx, views);
  assert.deepEqual(facets.statuses, { all: 5, live: 1, upcoming: 2, final: 2 });
  assert.equal(facets.views.all, 30);
  assert.equal(facets.views.sec, 5);
  assert.equal(facets.views['big-ten'], 5);
  assert.equal(facets.views.acc, 5);
  assert.equal(facets.live['power-4'], 5);
  assert.equal(facets.networks.get('ABC'), 2);

  const searching = computeFacets(games, prefs('college', { query: 'ohio state' }), ctx, views);
  assert.equal(searching.views.all, 1);
  assert.equal(searching.views.sec, 0);
  assert.equal(searching.live.all, 0, 'live markers follow the search');

  const liveOnly = computeFacets(games, prefs('college', { status: 'live' }), ctx, views);
  assert.equal(liveOnly.views.all, 7);
  assert.equal(liveOnly.statuses.all, 30, 'status tabs ignore the status filter');
});

test('matchup ordering puts ranked showdowns first', () => {
  const games = collegeGames();
  const sorted = ids(sortGames(games.filter((g) => g.away.rank || g.home.rank), 'matchup'));
  assert.deepEqual(sorted.slice(0, 5), ['19', '12', '13', '24', '05']);
  assert.ok(matchupScore(games[0]) < 1);

  // NFL: best combined records first; ties go to the earlier kickoff, then alphabetically.
  const nfl = sortGames(nflGames(), 'matchup');
  assert.deepEqual(ids(nfl).slice(0, 4), ['11', '13', '12', '14']);
});

test('conference breakdown: Top 25 first, then conferences by tier, then non-conference', () => {
  const games = collegeGames();
  const sections = buildSections(games, prefs('college'), makeContext('college'));
  assert.deepEqual(
    sections.map((s) => [s.key, s.title, s.eyebrow, s.games.length]),
    [
      ['top25', 'Top 25', 'Ranked teams', 19],
      ['conf-5', 'Big Ten', 'Power 4', 1],
      ['conf-1', 'ACC', 'Power 4', 1],
      ['conf-151', 'American', 'Group of 6', 1],
      ['conf-15', 'MAC', 'Group of 6', 1],
      ['conf-17', 'Mountain West', 'Group of 6', 1],
      ['conf-37', 'Sun Belt', 'Group of 6', 3],
      ['nonconf', 'Non-conference', '', 3],
    ],
  );
  assert.deepEqual(ids(sections[0].games).slice(0, 4), ['19', '12', '13', '24']);
});

test('inside the Top 25 view, games are broken down by conference', () => {
  const sections = buildSections(
    filterGames(collegeGames(), prefs('college', { view: 'top25' }), makeContext('college')),
    prefs('college', { view: 'top25' }),
    makeContext('college'),
  );
  assert.deepEqual(
    sections.map((s) => s.title),
    ['SEC', 'Big Ten', 'Big 12', 'ACC', 'American', 'Pac-12', 'Non-conference'],
  );
});

test('favorites are pinned above everything else', () => {
  const ctx = makeContext('college', { games: new Set(['401800028']) });
  const sections = buildSections(collegeGames(), prefs('college'), ctx);
  assert.equal(sections[0].key, 'favorites');
  assert.deepEqual(ids(sections[0].games), ['28']);
  assert.ok(!sections.slice(1).some((s) => s.games.some((g) => g.id === '401800028')), 'no duplicates');
});

test('day grouping pins live games and labels days in the viewer time zone', () => {
  const sections = buildSections(collegeGames(), prefs('college', { groupBy: 'day' }), makeContext('college'));
  assert.deepEqual(
    sections.map((s) => [s.key, s.title, s.eyebrow, s.games.length]),
    [
      ['live', 'Live now', '', 7],
      ['day-2026-09-24', 'Thursday, September 24', '', 1],
      ['day-2026-09-25', 'Friday, September 25', 'Yesterday', 2],
      ['day-2026-09-26', 'Saturday, September 26', 'Today', 20],
    ],
  );
  assert.deepEqual(ids(sections[0].games), ['12', '13', '14', '17', '16', '15', '18']);
  // The unscheduled game sorts after every timed kickoff that day.
  assert.equal(sections[3].games.at(-1).id, '401800029');
});

test('status grouping', () => {
  const sections = buildSections(collegeGames(), prefs('college', { groupBy: 'status' }), makeContext('college'));
  assert.deepEqual(
    sections.map((s) => [s.key, s.games.length]),
    [
      ['live', 7],
      ['upcoming', 11],
      ['final', 11],
      ['off', 1],
    ],
  );
});

test('nfl division grouping', () => {
  const sections = buildSections(nflGames(), prefs('nfl', { groupBy: 'division' }), makeContext('nfl'));
  assert.deepEqual(
    sections.map((s) => [s.key, s.games.length]),
    [
      ['afc-east', 2],
      ['afc-north', 2],
      ['afc-south', 2],
      ['afc-west', 1],
      ['nfc-east', 1],
      ['nfc-north', 2],
      ['nfc-south', 2],
      ['nfc-west', 1],
      ['nfc-other', 1],
      ['cross', 1],
    ],
  );
});

test('no grouping returns one untitled section', () => {
  const sections = buildSections(nflGames(), prefs('nfl', { groupBy: 'none' }), makeContext('nfl'));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, '');
  assert.equal(sections[0].games.length, 15);
});

test('team index finds each team’s game', () => {
  const index = indexGamesByTeam(collegeGames());
  assert.equal(index.get('251').id, '401800019');
  assert.equal(index.get('2633'), undefined, 'teams on a bye have no game');
});
