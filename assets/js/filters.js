// Filtering, facet counts, sorting and sectioning of normalized games.
// Everything here is pure so it can be unit tested without a browser.

import { COLLEGE_TIERS, NFL_DIVISIONS, fbsOrder, nflConferenceOfDivision } from './conferences.js';
import { formatDayTitle, gameDayKey, relativeDayLabel } from './format.js';
import { viewPredicate } from './views.js';

export const STATUS_FILTERS = ['all', 'live', 'upcoming', 'final'];

const ALWAYS = () => true;
const NEVER = () => false;

export function statusBucket(game) {
  if (game.state === 'in') return 'live';
  if (game.state === 'post' || game.postponed || game.canceled) return 'final';
  return 'upcoming';
}

export function isRankedGame(game) {
  return Boolean(game.away.rank || game.home.rank);
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’ʻ`.]/g, '')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();
}

const searchCache = new WeakMap();

// Fields are joined with " | " so a phrase can only match inside one field:
// "ohio state" finds the Buckeyes, not Ohio playing Kent State.
function searchText(game) {
  let cached = searchCache.get(game);
  if (!cached) {
    const fields = [];
    for (const team of [game.away, game.home]) {
      fields.push(team.displayName, team.name, team.location, team.mascot, team.abbr);
    }
    fields.push(...game.broadcasts, game.venue?.name, game.venue?.city, game.note);
    cached = fields
      .map(normalizeText)
      .filter(Boolean)
      .flatMap((field) => (field.includes('&') ? [field, field.replace(/&/g, '')] : [field]))
      .join(' | ');
    searchCache.set(game, cached);
  }
  return cached;
}

// "georgia vs alabama", "UGA @ ALA" and "texas, oklahoma" all mean "both of these".
const QUERY_SEPARATORS = /\s*(?:,|@|\bvs?\.?(?=\s|$)|\bat\b)\s*/i;

export function createQueryMatcher(query) {
  const parts = String(query || '')
    .split(QUERY_SEPARATORS)
    .map(normalizeText)
    .filter(Boolean);
  if (!parts.length) return ALWAYS;
  return (game) => {
    const haystack = searchText(game);
    return parts.every((part) => haystack.includes(part));
  };
}

export function matchesStatus(game, status) {
  return !status || status === 'all' || statusBucket(game) === status;
}

export function matchesNetwork(game, network) {
  return !network || game.broadcasts.includes(network);
}

export function filterGames(games, prefs, ctx) {
  const inView = viewPredicate(prefs.view, ctx) || ALWAYS;
  const matchesQuery = createQueryMatcher(prefs.query);
  return games.filter(
    (game) =>
      inView(game) &&
      matchesStatus(game, prefs.status) &&
      matchesNetwork(game, prefs.network) &&
      matchesQuery(game),
  );
}

/**
 * Counts that tell the viewer what each control would show. Each facet
 * applies every filter except its own, the way shopping-site filters work.
 */
export function computeFacets(games, prefs, ctx, views) {
  const statuses = { all: 0, live: 0, upcoming: 0, final: 0 };
  const viewCounts = Object.fromEntries(views.map((view) => [view, 0]));
  const liveCounts = Object.fromEntries(views.map((view) => [view, 0]));
  const networks = new Map();
  const inView = viewPredicate(prefs.view, ctx) || ALWAYS;
  const matchesQuery = createQueryMatcher(prefs.query);
  const predicates = views.map((view) => [view, viewPredicate(view, ctx) || NEVER]);

  for (const game of games) {
    const bucket = statusBucket(game);
    const query = matchesQuery(game);
    const network = matchesNetwork(game, prefs.network);
    const status = matchesStatus(game, prefs.status);
    const view = inView(game);
    if (view && query && network) {
      statuses.all += 1;
      statuses[bucket] += 1;
    }
    for (const [name, predicate] of predicates) {
      if (!query || !network || !predicate(game)) continue;
      if (status) viewCounts[name] += 1;
      if (bucket === 'live') liveCounts[name] += 1;
    }
    if (view && query && status) {
      for (const channel of game.broadcasts) networks.set(channel, (networks.get(channel) || 0) + 1);
    }
  }
  return { statuses, views: viewCounts, live: liveCounts, networks };
}

function winPct(record) {
  const match = /^(\d+)-(\d+)(?:-(\d+))?/.exec(record || '');
  if (!match) return null;
  const [wins, losses, ties] = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  const played = wins + losses + ties;
  return played ? (wins + ties / 2) / played : null;
}

/** Lower is a bigger game: ranked-vs-ranked first in college, best records in the NFL. */
export function matchupScore(game) {
  if (game.league === 'nfl') {
    const away = winPct(game.away.record);
    const home = winPct(game.home.record);
    if (away === null && home === null) return 1;
    return 1 - ((away ?? 0.5) + (home ?? 0.5)) / 2;
  }
  const a = game.away.rank;
  const h = game.home.rank;
  if (a && h) return (Math.min(a, h) + Math.max(a, h) / 100) / 100;
  if (a || h) return (30 + (a || h)) / 100;
  return 1;
}

function kickoffValue(game) {
  const time = Date.parse(game.date);
  if (!Number.isFinite(time)) return Infinity;
  // Unscheduled kickoffs sort after the day's timed games.
  return game.timeValid ? time : time + 86_000_000;
}

function compareKickoff(a, b) {
  return (
    kickoffValue(a) - kickoffValue(b) ||
    matchupScore(a) - matchupScore(b) ||
    a.shortName.localeCompare(b.shortName)
  );
}

function compareMatchup(a, b) {
  return matchupScore(a) - matchupScore(b) || compareKickoff(a, b);
}

export function sortGames(games, mode = 'time') {
  return [...games].sort(mode === 'matchup' ? compareMatchup : compareKickoff);
}

function section(key, title, games, { kind = 'group', eyebrow = '', showDay = true } = {}) {
  return { key, kind, title, eyebrow, showDay, games };
}

function daySections(games, prefs, ctx) {
  const byDay = new Map();
  for (const game of games) {
    const key = gameDayKey(game, ctx.timeZone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(game);
  }
  return [...byDay.keys()].sort().map((key) =>
    section(`day-${key}`, formatDayTitle(key), sortGames(byDay.get(key), prefs.sortBy), {
      kind: 'day',
      eyebrow: relativeDayLabel(key, ctx.now, ctx.timeZone),
      showDay: false,
    }),
  );
}

function statusSections(games, prefs) {
  const buckets = { live: [], upcoming: [], final: [], off: [] };
  for (const game of games) {
    buckets[game.postponed || game.canceled ? 'off' : statusBucket(game)].push(game);
  }
  return [
    section('live', 'Live now', sortGames(buckets.live, prefs.sortBy), { kind: 'live', showDay: false }),
    section('upcoming', 'Upcoming', sortGames(buckets.upcoming, prefs.sortBy)),
    section('final', 'Final', sortGames(buckets.final, prefs.sortBy)),
    section('off', 'Postponed & canceled', sortGames(buckets.off, prefs.sortBy)),
  ];
}

function tierEyebrow(info) {
  if (!info) return '';
  if (info.tier === 'power' || info.tier === 'group') return COLLEGE_TIERS[info.tier].label;
  return '';
}

function conferenceSections(games, prefs, ctx) {
  const sections = [];
  let rest = games;
  // Inside the Top 25 views every game is ranked, so break those down by conference instead.
  if (prefs.view !== 'top25' && prefs.view !== 'ranked') {
    const ranked = rest.filter(isRankedGame);
    if (ranked.length) {
      sections.push(section('top25', 'Top 25', sortGames(ranked, 'matchup'), { kind: 'top25', eyebrow: 'Ranked teams' }));
      rest = rest.filter((game) => !isRankedGame(game));
    }
  }
  const byConference = new Map();
  const nonConference = [];
  for (const game of rest) {
    const id = game.conferenceGame ? game.home.conferenceId || game.away.conferenceId : null;
    if (!id) {
      nonConference.push(game);
      continue;
    }
    if (!byConference.has(id)) byConference.set(id, []);
    byConference.get(id).push(game);
  }
  const name = (id) => ctx.conference(id)?.name || `Conference ${id}`;
  const ids = [...byConference.keys()].sort((a, b) => fbsOrder(a) - fbsOrder(b) || name(a).localeCompare(name(b)));
  for (const id of ids) {
    sections.push(
      section(`conf-${id}`, name(id), sortGames(byConference.get(id), prefs.sortBy), {
        kind: 'conference',
        eyebrow: tierEyebrow(ctx.conference(id)),
      }),
    );
  }
  sections.push(
    section('nonconf', 'Non-conference', sortGames(nonConference, prefs.sortBy), { kind: 'conference' }),
  );
  return sections;
}

function divisionSections(games, prefs) {
  const byDivision = new Map();
  const other = { afc: [], nfc: [], cross: [] };
  for (const game of games) {
    if (game.divisionGame) {
      if (!byDivision.has(game.home.division)) byDivision.set(game.home.division, []);
      byDivision.get(game.home.division).push(game);
      continue;
    }
    const away = nflConferenceOfDivision(game.away.division);
    const home = nflConferenceOfDivision(game.home.division);
    other[away && away === home ? away : 'cross'].push(game);
  }
  const sections = NFL_DIVISIONS.filter((d) => byDivision.has(d.slug)).map((d) =>
    section(d.slug, d.name, sortGames(byDivision.get(d.slug), prefs.sortBy), {
      kind: 'division',
      eyebrow: 'Division games',
    }),
  );
  sections.push(
    section('afc-other', 'AFC matchups', sortGames(other.afc, prefs.sortBy), { kind: 'division' }),
    section('nfc-other', 'NFC matchups', sortGames(other.nfc, prefs.sortBy), { kind: 'division' }),
    section('cross', 'AFC vs. NFC', sortGames(other.cross, prefs.sortBy), { kind: 'division' }),
  );
  return sections;
}

/**
 * Split filtered games into titled sections. Favorites are pinned to the top
 * (outside the Favorites view); day grouping also pins games in progress.
 */
export function buildSections(games, prefs, ctx) {
  const sections = [];
  let rest = games;

  if (prefs.view !== 'favorites') {
    const favorites = rest.filter((game) => ctx.isFavorite(game));
    if (favorites.length) {
      sections.push(section('favorites', 'Your favorites', sortGames(favorites), { kind: 'favorites' }));
      rest = rest.filter((game) => !ctx.isFavorite(game));
    }
  }

  const groupBy = prefs.groupBy;
  if (groupBy === 'day') {
    const live = rest.filter((game) => game.state === 'in');
    if (live.length) {
      sections.push(section('live', 'Live now', sortGames(live, prefs.sortBy), { kind: 'live', showDay: false }));
      rest = rest.filter((game) => game.state !== 'in');
    }
    sections.push(...daySections(rest, prefs, ctx));
  } else if (groupBy === 'status') {
    sections.push(...statusSections(rest, prefs));
  } else if (groupBy === 'conference' && ctx.league === 'college') {
    sections.push(...conferenceSections(rest, prefs, ctx));
  } else if (groupBy === 'division' && ctx.league === 'nfl') {
    sections.push(...divisionSections(rest, prefs));
  } else {
    sections.push(section('all', '', sortGames(rest, prefs.sortBy), { kind: 'plain' }));
  }
  return sections.filter((s) => s.games.length);
}

export function indexGamesByTeam(games) {
  const index = new Map();
  for (const game of games) {
    index.set(game.away.id, game);
    index.set(game.home.id, game);
  }
  return index;
}
