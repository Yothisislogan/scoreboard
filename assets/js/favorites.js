// Favorite matchups (individual games) and followed teams, kept in
// localStorage. Each favorite game stores a small snapshot so it can be
// listed and revisited even when a different week is on screen.

export const FAVORITES_KEY = 'gridiron.favorites.v1';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 200;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

export function safeStorage() {
  try {
    const storage = globalThis.localStorage;
    const probe = '__gridiron_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
}

function teamSnapshot(team) {
  return {
    id: String(team.id),
    abbr: team.abbr || '',
    name: team.name || team.displayName || '',
    logo: team.logo || null,
    color: team.color || null,
  };
}

export function gameSnapshot(game, extra = {}) {
  return {
    id: String(game.id),
    league: game.league,
    date: game.date,
    timeValid: game.timeValid !== false,
    shortName: game.shortName,
    away: teamSnapshot(game.away),
    home: teamSnapshot(game.home),
    week: game.week ? { ...game.week } : null,
    ...extra,
  };
}

function emptyData() {
  return { games: {}, teams: {} };
}

function sanitize(raw, now) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  for (const [id, game] of Object.entries(raw.games || {})) {
    if (!game || typeof game !== 'object' || !game.league) continue;
    const time = Date.parse(game.date);
    if (Number.isFinite(time) && now - time > MAX_AGE_MS) continue;
    data.games[id] = game;
  }
  for (const [key, team] of Object.entries(raw.teams || {})) {
    if (team && typeof team === 'object' && team.league && team.id) data.teams[key] = team;
  }
  return data;
}

const teamKey = (league, id) => `${league}:${id}`;

export function createFavorites(storage = safeStorage(), { now = () => Date.now() } = {}) {
  let data = emptyData();
  const listeners = new Set();

  const load = () => {
    try {
      data = sanitize(JSON.parse(storage.getItem(FAVORITES_KEY) || 'null'), now());
    } catch {
      data = emptyData();
    }
  };
  const save = () => {
    try {
      storage.setItem(FAVORITES_KEY, JSON.stringify(data));
    } catch {
      // Storage full or blocked: favorites still work for this visit.
    }
  };
  const emit = () => listeners.forEach((listener) => listener());

  load();

  return {
    isGame: (id) => Object.hasOwn(data.games, String(id)),
    isTeam: (league, id) => Object.hasOwn(data.teams, teamKey(league, id)),
    isFavorite(game) {
      return (
        this.isGame(game.id) || this.isTeam(game.league, game.away.id) || this.isTeam(game.league, game.home.id)
      );
    },
    /** Toggle a matchup; returns true when it is now a favorite. */
    toggleGame(game, extra = {}) {
      const id = String(game.id);
      const added = !Object.hasOwn(data.games, id);
      if (added) data.games[id] = { ...gameSnapshot(game, extra), savedAt: now() };
      else delete data.games[id];
      save();
      emit();
      return added;
    },
    /** Toggle following a team; returns true when it is now followed. */
    toggleTeam(league, team) {
      const key = teamKey(league, team.id);
      const added = !Object.hasOwn(data.teams, key);
      if (added) data.teams[key] = { league, ...teamSnapshot(team), savedAt: now() };
      else delete data.teams[key];
      save();
      emit();
      return added;
    },
    /** Refresh a saved snapshot (kickoff moved, etc.) without changing membership. */
    refreshGame(game, extra = {}) {
      const id = String(game.id);
      const saved = data.games[id];
      if (!saved) return;
      const next = { ...saved, ...gameSnapshot(game, extra) };
      if (JSON.stringify(next) === JSON.stringify(saved)) return;
      data.games[id] = next;
      save();
    },
    games: (league) => Object.values(data.games).filter((game) => !league || game.league === league),
    teams: (league) => Object.values(data.teams).filter((team) => !league || team.league === league),
    reload() {
      load();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
