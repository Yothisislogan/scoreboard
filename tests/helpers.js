import { readFileSync } from 'node:fs';
import { describeConference } from '../assets/js/conferences.js';
import { normalizeScoreboard } from '../assets/js/normalize.js';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

export function collegeGames() {
  return normalizeScoreboard(fixture('college-scoreboard.json'), { league: 'college', division: 'fbs' }).games;
}

export function nflGames() {
  return normalizeScoreboard(fixture('nfl-scoreboard.json'), { league: 'nfl' }).games;
}

/** A filter/render context like the app builds, with favorites held in plain sets. */
export function makeContext(league, { games = new Set(), teams = new Set(), now = Date.parse('2026-09-26T20:45:00Z') } = {}) {
  return {
    league,
    timeZone: 'America/New_York',
    now,
    isGameFavorite: (id) => games.has(id),
    isTeamFollowed: (teamLeague, id) => teams.has(`${teamLeague}:${id}`),
    isFavorite: (game) =>
      games.has(game.id) || teams.has(`${game.league}:${game.away.id}`) || teams.has(`${game.league}:${game.home.id}`),
    conference: (id) => describeConference(id, {}),
    scoreChange: () => null,
  };
}

export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}
