import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAVORITES_KEY, createFavorites } from '../assets/js/favorites.js';
import { collegeGames, memoryStorage } from './helpers.js';

const NOW = Date.parse('2026-09-26T20:45:00Z');
const clock = () => NOW;

test('favorite a matchup, persist it, and remove it', () => {
  const storage = memoryStorage();
  const favorites = createFavorites(storage, { now: clock });
  const game = collegeGames().find((g) => g.id === '401800019');

  assert.equal(favorites.toggleGame(game, { division: 'fbs' }), true);
  assert.ok(favorites.isGame('401800019'));
  assert.ok(favorites.isFavorite(game));

  const saved = JSON.parse(storage.getItem(FAVORITES_KEY)).games['401800019'];
  assert.equal(saved.shortName, 'MISS @ TEX');
  assert.equal(saved.league, 'college');
  assert.equal(saved.division, 'fbs');
  assert.deepEqual(saved.week, { year: 2026, seasonType: 2, week: 4 });
  assert.equal(saved.home.name, 'Texas');

  // A second store reading the same storage sees it (e.g. after a reload).
  assert.ok(createFavorites(storage, { now: clock }).isGame('401800019'));

  assert.equal(favorites.toggleGame(game), false);
  assert.ok(!favorites.isGame('401800019'));
  assert.deepEqual(favorites.games(), []);
});

test('following a team makes all of its games favorites', () => {
  const favorites = createFavorites(memoryStorage(), { now: clock });
  const games = collegeGames();
  const ohioState = games.find((g) => g.id === '401800005').home;
  assert.equal(favorites.toggleTeam('college', ohioState), true);
  assert.ok(favorites.isTeam('college', '194'));
  assert.ok(!favorites.isTeam('nfl', '194'), 'follows are per league');
  assert.deepEqual(
    games.filter((g) => favorites.isFavorite(g)).map((g) => g.id),
    ['401800005'],
  );
  assert.deepEqual(
    favorites.teams('college').map((team) => team.name),
    ['Ohio State'],
  );
  assert.equal(favorites.toggleTeam('college', { id: '194' }), false);
  assert.deepEqual(favorites.teams(), []);
});

test('listeners hear about changes', () => {
  const favorites = createFavorites(memoryStorage(), { now: clock });
  let calls = 0;
  const unsubscribe = favorites.subscribe(() => {
    calls += 1;
  });
  favorites.toggleGame(collegeGames()[0]);
  favorites.toggleTeam('nfl', { id: '12', name: 'Chiefs' });
  unsubscribe();
  favorites.toggleTeam('nfl', { id: '12' });
  assert.equal(calls, 2);
});

test('refreshGame updates a saved snapshot without adding new favorites', () => {
  const storage = memoryStorage();
  const favorites = createFavorites(storage, { now: clock });
  const game = collegeGames().find((g) => g.id === '401800029');
  favorites.refreshGame(game);
  assert.ok(!favorites.isGame(game.id));
  favorites.toggleGame(game);
  favorites.refreshGame({ ...game, date: '2026-09-27T01:00Z', timeValid: true });
  const saved = favorites.games()[0];
  assert.equal(saved.date, '2026-09-27T01:00Z');
  assert.equal(saved.timeValid, true);
});

test('survives corrupt or unavailable storage', () => {
  const corrupt = memoryStorage({ [FAVORITES_KEY]: '{not json' });
  assert.deepEqual(createFavorites(corrupt, { now: clock }).games(), []);

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  const favorites = createFavorites(broken, { now: clock });
  const game = collegeGames()[0];
  assert.equal(favorites.toggleGame(game), true);
  assert.ok(favorites.isGame(game.id), 'works in memory for the visit');
});

test('drops malformed entries and very old matchups on load', () => {
  const storage = memoryStorage({
    [FAVORITES_KEY]: JSON.stringify({
      games: {
        old: { league: 'nfl', date: '2025-09-01T17:00Z' },
        recent: { league: 'nfl', date: '2026-09-20T17:00Z' },
        broken: 'nope',
        noLeague: { date: '2026-09-20T17:00Z' },
      },
      teams: { 'nfl:12': { league: 'nfl', id: '12' }, bad: null },
    }),
  });
  const favorites = createFavorites(storage, { now: clock });
  assert.deepEqual(
    favorites.games().map((game) => game.league + game.date),
    ['nfl2026-09-20T17:00Z'],
  );
  assert.ok(favorites.isGame('recent'));
  assert.ok(!favorites.isGame('old'));
  assert.ok(favorites.isTeam('nfl', '12'));
});
