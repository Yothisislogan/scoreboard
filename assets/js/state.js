// View preferences: defaults, validation, the shareable URL hash, and the
// subset remembered between visits.

export const LEAGUES = ['nfl', 'college'];
export const STATUS_VALUES = ['all', 'live', 'upcoming', 'final'];
export const DIVISIONS = ['fbs', 'fcs'];

export const GROUP_OPTIONS = {
  nfl: [
    { value: 'day', label: 'Day' },
    { value: 'status', label: 'Status' },
    { value: 'division', label: 'Division' },
    { value: 'none', label: 'No grouping' },
  ],
  college: [
    { value: 'conference', label: 'Top 25 & conference' },
    { value: 'day', label: 'Day' },
    { value: 'status', label: 'Status' },
    { value: 'none', label: 'No grouping' },
  ],
};

export const SORT_OPTIONS = [
  { value: 'time', label: 'Kickoff time' },
  { value: 'matchup', label: 'Best matchups' },
];

export const PREFS_KEY = 'gridiron.prefs.v1';
// Only structural choices survive a fresh visit; searches, status filters and
// week picks live in the URL so a new visit always opens on this week's games.
const REMEMBERED = ['view', 'groupBy', 'sortBy', 'division'];

const VIEW_PATTERN = /^[a-z0-9-]{1,40}$/;

export function defaultPrefs(league) {
  return {
    view: 'all',
    status: 'all',
    query: '',
    network: '',
    groupBy: league === 'college' ? 'conference' : 'day',
    sortBy: 'time',
    week: null,
    division: 'fbs',
  };
}

function isWeek(value) {
  return (
    Boolean(value) &&
    Number.isInteger(value.year) &&
    Number.isInteger(value.seasonType) &&
    Number.isInteger(value.week) &&
    value.seasonType >= 1 &&
    value.seasonType <= 4 &&
    value.week >= 1
  );
}

export function sanitizePrefs(league, input = {}) {
  const prefs = defaultPrefs(league);
  if (!input || typeof input !== 'object') return prefs;
  if (typeof input.view === 'string' && VIEW_PATTERN.test(input.view)) prefs.view = input.view;
  if (STATUS_VALUES.includes(input.status)) prefs.status = input.status;
  if (typeof input.query === 'string') prefs.query = input.query.slice(0, 80);
  if (typeof input.network === 'string') prefs.network = input.network.slice(0, 40);
  if (GROUP_OPTIONS[league].some((o) => o.value === input.groupBy)) prefs.groupBy = input.groupBy;
  if (SORT_OPTIONS.some((o) => o.value === input.sortBy)) prefs.sortBy = input.sortBy;
  if (isWeek(input.week)) {
    prefs.week = { year: input.week.year, seasonType: input.week.seasonType, week: input.week.week };
  }
  if (league === 'college' && DIVISIONS.includes(input.division)) prefs.division = input.division;
  return prefs;
}

export function formatWeekParam(week) {
  return `${week.year}-${week.seasonType}-${week.week}`;
}

export function parseWeekParam(value) {
  const match = /^(\d{4})-([1-4])-(\d{1,2})$/.exec(value || '');
  return match ? { year: Number(match[1]), seasonType: Number(match[2]), week: Number(match[3]) } : null;
}

export function sameWeek(a, b) {
  return Boolean(a && b) && a.year === b.year && a.seasonType === b.seasonType && a.week === b.week;
}

export function weekKey(week) {
  return week ? formatWeekParam(week) : 'current';
}

/** "#/college/sec?status=live&q=georgia", listing only non-default choices. */
export function buildHash(league, prefs, { game = null } = {}) {
  const defaults = defaultPrefs(league);
  const params = new URLSearchParams();
  if (prefs.status !== defaults.status) params.set('status', prefs.status);
  if (prefs.query) params.set('q', prefs.query);
  if (prefs.network) params.set('tv', prefs.network);
  if (prefs.groupBy !== defaults.groupBy) params.set('group', prefs.groupBy);
  if (prefs.sortBy !== defaults.sortBy) params.set('sort', prefs.sortBy);
  if (league === 'college' && prefs.division !== defaults.division) params.set('div', prefs.division);
  if (prefs.week) params.set('week', formatWeekParam(prefs.week));
  if (game) params.set('game', game);
  const query = params.toString();
  return `#/${league}/${prefs.view}${query ? `?${query}` : ''}`;
}

export function parseHash(hash) {
  const match = /^#\/(nfl|college)(?:\/([a-z0-9-]{1,40}))?\/?(?:\?(.*))?$/.exec(hash || '');
  if (!match) return null;
  const [, league, view, query] = match;
  const params = new URLSearchParams(query || '');
  const prefs = { view: view || 'all' };
  if (params.has('status')) prefs.status = params.get('status');
  if (params.has('q')) prefs.query = params.get('q');
  if (params.has('tv')) prefs.network = params.get('tv');
  if (params.has('group')) prefs.groupBy = params.get('group');
  if (params.has('sort')) prefs.sortBy = params.get('sort');
  if (params.has('div')) prefs.division = params.get('div');
  if (params.has('week')) prefs.week = parseWeekParam(params.get('week'));
  return { league, prefs, game: params.get('game') || null };
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source && source[key] !== undefined) out[key] = source[key];
  return out;
}

export function loadSavedState(storage) {
  let saved = {};
  try {
    saved = JSON.parse(storage.getItem(PREFS_KEY) || 'null') || {};
  } catch {
    saved = {};
  }
  return {
    league: LEAGUES.includes(saved.league) ? saved.league : null,
    prefs: Object.fromEntries(LEAGUES.map((league) => [league, sanitizePrefs(league, pick(saved[league], REMEMBERED))])),
  };
}

export function saveState(storage, league, prefsByLeague) {
  const payload = { league };
  for (const key of LEAGUES) payload[key] = pick(prefsByLeague[key], REMEMBERED);
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing or full storage: preferences just won't persist.
  }
}

/** First visit: college on Fridays and Saturdays, the NFL otherwise. */
export function defaultLeague(now = new Date()) {
  const day = now.getDay();
  return day === 5 || day === 6 ? 'college' : 'nfl';
}
