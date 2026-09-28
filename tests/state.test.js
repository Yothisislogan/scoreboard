import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PREFS_KEY,
  buildHash,
  defaultLeague,
  defaultPrefs,
  loadSavedState,
  parseHash,
  parseWeekParam,
  sameWeek,
  sanitizePrefs,
  saveState,
  weekKey,
} from '../assets/js/state.js';
import { memoryStorage } from './helpers.js';

test('defaults differ per league', () => {
  assert.equal(defaultPrefs('college').groupBy, 'conference');
  assert.equal(defaultPrefs('nfl').groupBy, 'day');
  assert.equal(defaultPrefs('college').division, 'fbs');
});

test('hash lists only what differs from the defaults', () => {
  assert.equal(buildHash('nfl', defaultPrefs('nfl')), '#/nfl/all');
  const prefs = {
    ...defaultPrefs('college'),
    view: 'sec',
    status: 'live',
    query: 'georgia vs alabama',
    network: 'ESPN+',
    groupBy: 'day',
    sortBy: 'matchup',
    division: 'fcs',
    week: { year: 2026, seasonType: 2, week: 7 },
  };
  const hash = buildHash('college', prefs, { game: '401800012' });
  assert.equal(
    hash,
    '#/college/sec?status=live&q=georgia+vs+alabama&tv=ESPN%2B&group=day&sort=matchup&div=fcs&week=2026-2-7&game=401800012',
  );
  const parsed = parseHash(hash);
  assert.equal(parsed.league, 'college');
  assert.equal(parsed.game, '401800012');
  assert.deepEqual(sanitizePrefs('college', parsed.prefs), prefs);
});

test('parseHash rejects unknown shapes', () => {
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#/mlb/all'), null);
  assert.equal(parseHash('#/nfl/<script>'), null);
  assert.deepEqual(parseHash('#/nfl'), { league: 'nfl', prefs: { view: 'all' }, game: null });
});

test('sanitizePrefs drops invalid values', () => {
  const prefs = sanitizePrefs('nfl', {
    view: 'DROP TABLE',
    status: 'sometimes',
    query: 'x'.repeat(200),
    groupBy: 'conference',
    sortBy: 'random',
    division: 'fcs',
    week: { year: 2026, seasonType: 9, week: 1 },
  });
  assert.equal(prefs.view, 'all');
  assert.equal(prefs.status, 'all');
  assert.equal(prefs.query.length, 80);
  assert.equal(prefs.groupBy, 'day', 'conference grouping is college-only');
  assert.equal(prefs.sortBy, 'time');
  assert.equal(prefs.division, 'fbs', 'division is college-only');
  assert.equal(prefs.week, null);
  assert.deepEqual(sanitizePrefs('college', null), defaultPrefs('college'));
});

test('week helpers', () => {
  assert.deepEqual(parseWeekParam('2026-3-1'), { year: 2026, seasonType: 3, week: 1 });
  assert.equal(parseWeekParam('2026-5-1'), null);
  assert.equal(parseWeekParam('soon'), null);
  assert.ok(sameWeek({ year: 2026, seasonType: 2, week: 4 }, { year: 2026, seasonType: 2, week: 4, label: 'Week 4' }));
  assert.ok(!sameWeek(null, { year: 2026, seasonType: 2, week: 4 }));
  assert.equal(weekKey(null), 'current');
  assert.equal(weekKey({ year: 2026, seasonType: 2, week: 4 }), '2026-2-4');
});

test('only structural choices are remembered between visits', () => {
  const storage = memoryStorage();
  const college = { ...defaultPrefs('college'), view: 'sec', groupBy: 'day', status: 'live', query: 'uga', week: { year: 2026, seasonType: 2, week: 2 } };
  saveState(storage, 'college', { nfl: defaultPrefs('nfl'), college });
  assert.deepEqual(JSON.parse(storage.getItem(PREFS_KEY)).college, {
    view: 'sec',
    groupBy: 'day',
    sortBy: 'time',
    division: 'fbs',
  });
  const restored = loadSavedState(storage);
  assert.equal(restored.league, 'college');
  assert.equal(restored.prefs.college.view, 'sec');
  assert.equal(restored.prefs.college.groupBy, 'day');
  assert.equal(restored.prefs.college.status, 'all');
  assert.equal(restored.prefs.college.query, '');
  assert.equal(restored.prefs.college.week, null);

  const empty = loadSavedState(memoryStorage({ [PREFS_KEY]: 'garbage' }));
  assert.equal(empty.league, null);
  assert.deepEqual(empty.prefs.nfl, defaultPrefs('nfl'));
});

test('first visit opens college on Fridays and Saturdays', () => {
  assert.equal(defaultLeague(new Date(2026, 8, 26)), 'college'); // Saturday
  assert.equal(defaultLeague(new Date(2026, 8, 25)), 'college'); // Friday
  assert.equal(defaultLeague(new Date(2026, 8, 27)), 'nfl'); // Sunday
  assert.equal(defaultLeague(new Date(2026, 8, 29)), 'nfl'); // Tuesday
});
