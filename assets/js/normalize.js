// Turn ESPN's scoreboard, rankings and standings payloads into the small,
// predictable shapes the rest of the app uses. Every field is read
// defensively: ESPN omits keys freely depending on game state.

import { nflDivisionOf } from './conferences.js';

const INDEPENDENT_CONFERENCES = new Set(['18', '32']);

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toColor(value) {
  return typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeScoreboard(raw, { league = 'nfl', division = null } = {}) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const leagueInfo = asArray(data.leagues)[0] || {};
  const year = toNumber(data.season?.year) ?? toNumber(leagueInfo.season?.year);
  const seasonType = toNumber(data.season?.type) ?? toNumber(leagueInfo.season?.type?.type);
  const weekNumber = toNumber(data.week?.number);
  const context = { league, year, seasonType, weekNumber, conferenceNames: {} };
  const games = [];
  for (const event of asArray(data.events)) {
    const game = normalizeEvent(event, context);
    if (game) games.push(game);
  }
  return {
    league,
    division,
    season: { year, type: seasonType },
    week: weekNumber ? { year, seasonType, week: weekNumber } : null,
    calendar: normalizeCalendar(leagueInfo.calendar, year),
    games,
    byes: asArray(data.week?.teamsOnBye).map(normalizeByeTeam).filter(Boolean),
    conferenceNames: context.conferenceNames,
  };
}

function normalizeCalendar(calendar, year) {
  const weeks = [];
  for (const block of asArray(calendar)) {
    if (!block || typeof block !== 'object') continue;
    const seasonType = toNumber(block.value);
    // 1 = preseason, 2 = regular season, 3 = postseason, 4 = off season.
    if (!seasonType || seasonType > 3) continue;
    for (const entry of asArray(block.entries)) {
      const week = toNumber(entry?.value);
      if (!week) continue;
      weeks.push({
        year,
        seasonType,
        week,
        label: text(entry.label) || `Week ${week}`,
        shortLabel: text(entry.alternateLabel) || text(entry.label) || `Wk ${week}`,
        detail: text(entry.detail),
        group: text(block.label),
        startDate: entry.startDate || null,
        endDate: entry.endDate || null,
      });
    }
  }
  return weeks;
}

function normalizeByeTeam(team) {
  if (!team || typeof team !== 'object') return null;
  return {
    id: String(team.id ?? ''),
    abbr: text(team.abbreviation),
    name: text(team.shortDisplayName) || text(team.displayName) || text(team.name),
    displayName: text(team.displayName),
    logo: team.logo || asArray(team.logos)[0]?.href || null,
  };
}

function statusFlags(name) {
  return {
    postponed: /POSTPONED/.test(name),
    canceled: /CANCEL?LED/.test(name),
    delayed: /DELAY/.test(name),
    suspended: /SUSPENDED/.test(name),
  };
}

function normalizeEvent(event, context) {
  const competition = asArray(event?.competitions)[0];
  if (!competition || event.id === undefined || event.id === null) return null;
  const competitors = asArray(competition.competitors);
  const homeRaw = competitors.find((c) => c?.homeAway === 'home') || competitors[0];
  const awayRaw = competitors.find((c) => c?.homeAway === 'away') || competitors.find((c) => c !== homeRaw);
  if (!homeRaw || !awayRaw) return null;

  const status = competition.status || event.status || {};
  const type = status.type || {};
  const state = ['pre', 'in', 'post'].includes(type.state) ? type.state : 'pre';
  const statusName = text(type.name);
  const league = context.league;

  const flags = statusFlags(statusName);
  // Postponed and canceled games often report 0-0; show no score instead.
  const scoreless = state === 'pre' || flags.postponed || flags.canceled;
  const home = normalizeTeam(homeRaw, scoreless, league);
  const away = normalizeTeam(awayRaw, scoreless, league);

  const group = competition.groups;
  if (group?.id && (group.shortName || group.name)) {
    context.conferenceNames[String(group.id)] = {
      name: text(group.shortName) || text(group.name),
      fullName: text(group.name) || text(group.shortName),
    };
  }

  const sharedConference =
    Boolean(home.conferenceId) &&
    home.conferenceId === away.conferenceId &&
    !INDEPENDENT_CONFERENCES.has(home.conferenceId);
  const conferenceGame =
    league === 'college'
      ? typeof competition.conferenceCompetition === 'boolean'
        ? competition.conferenceCompetition && Boolean(home.conferenceId || away.conferenceId)
        : sharedConference
      : false;

  const id = String(event.id);
  return {
    id,
    league,
    date: competition.date || event.date || null,
    timeValid: competition.timeValid !== false,
    name: text(event.name) || `${away.displayName} at ${home.displayName}`,
    shortName: text(event.shortName) || `${away.abbr || away.name} @ ${home.abbr || home.name}`,
    state,
    statusName,
    statusDetail: text(type.detail) || text(type.description),
    statusShort: text(type.shortDetail) || text(type.detail) || text(type.description),
    completed: type.completed === true,
    period: toNumber(status.period) || 0,
    clock: text(status.displayClock),
    ...flags,
    neutralSite: competition.neutralSite === true,
    conferenceGame,
    divisionGame: league === 'nfl' && Boolean(home.division) && home.division === away.division,
    venue: normalizeVenue(competition.venue),
    broadcasts: normalizeBroadcasts(competition),
    odds: normalizeOdds(competition.odds),
    situation: state === 'in' ? normalizeSituation(competition.situation) : null,
    note: asArray(competition.notes).map((n) => text(n?.headline)).find(Boolean) || null,
    attendance: toNumber(competition.attendance) || null,
    link: eventLink(event, league, id),
    leaders: normalizeLeaders(competition, [home, away]),
    week: {
      year: toNumber(event.season?.year) ?? context.year,
      seasonType: toNumber(event.season?.type) ?? context.seasonType,
      week: toNumber(event.week?.number) ?? context.weekNumber,
    },
    away,
    home,
  };
}

function normalizeTeam(competitor, scoreless, league) {
  const team = competitor.team || {};
  const records = asArray(competitor.records);
  const overall =
    records.find((r) => r?.type === 'total' || r?.name === 'overall' || r?.name === 'All Splits') || records[0];
  const conference = records.find((r) => r?.type === 'vsconf' || /conf/i.test(r?.name || ''));
  const rank = toNumber(competitor.curatedRank?.current);
  const rawScore = competitor.score && typeof competitor.score === 'object' ? competitor.score.value : competitor.score;
  const location = text(team.location);
  const mascot = text(team.name);
  return {
    id: String(team.id ?? competitor.id ?? ''),
    abbr: text(team.abbreviation),
    name: text(team.shortDisplayName) || location || text(team.displayName) || mascot || 'TBD',
    displayName: text(team.displayName) || [location, mascot].filter(Boolean).join(' ') || 'TBD',
    location,
    mascot,
    logo: team.logo || asArray(team.logos)[0]?.href || null,
    color: toColor(team.color),
    altColor: toColor(team.alternateColor),
    rank: rank && rank >= 1 && rank <= 25 ? rank : null,
    record: text(overall?.summary) || null,
    confRecord: conference && conference !== overall ? text(conference.summary) || null : null,
    score: scoreless ? null : toNumber(rawScore),
    winner: competitor.winner === true,
    linescores: asArray(competitor.linescores)
      .map((line) => toNumber(line?.value ?? line?.displayValue))
      .filter((value) => value !== null),
    conferenceId: team.conferenceId !== undefined && team.conferenceId !== null ? String(team.conferenceId) : null,
    division: league === 'nfl' ? nflDivisionOf(team)?.slug ?? null : null,
    homeAway: competitor.homeAway === 'away' ? 'away' : 'home',
  };
}

function normalizeVenue(venue) {
  if (!venue || typeof venue !== 'object') return null;
  const name = text(venue.fullName) || text(venue.name);
  const city = text(venue.address?.city);
  const state = text(venue.address?.state);
  if (!name && !city) return null;
  return { name, city, state, indoor: venue.indoor === true };
}

function normalizeBroadcasts(competition) {
  const names = new Set();
  for (const broadcast of asArray(competition.broadcasts)) {
    for (const name of asArray(broadcast?.names)) if (text(name)) names.add(text(name));
  }
  if (!names.size) {
    for (const geo of asArray(competition.geoBroadcasts)) {
      const name = text(geo?.media?.shortName);
      if (name) names.add(name);
    }
  }
  if (!names.size && text(competition.broadcast)) names.add(text(competition.broadcast));
  return [...names];
}

function normalizeOdds(odds) {
  const line = asArray(odds)[0];
  if (!line) return null;
  const details = text(line.details) || null;
  const overUnder = toNumber(line.overUnder);
  if (!details && overUnder === null) return null;
  return { details, overUnder, provider: text(line.provider?.name) || null };
}

function normalizeSituation(situation) {
  if (!situation || typeof situation !== 'object') return null;
  const probability = situation.lastPlay?.probability;
  const homeWin = toNumber(probability?.homeWinPercentage);
  const awayWin = toNumber(probability?.awayWinPercentage);
  return {
    downDistance: text(situation.downDistanceText) || null,
    shortDownDistance: text(situation.shortDownDistanceText) || null,
    possession: situation.possession !== undefined && situation.possession !== null ? String(situation.possession) : null,
    possessionText: text(situation.possessionText) || null,
    isRedZone: situation.isRedZone === true,
    lastPlay: text(situation.lastPlay?.text) || null,
    homeTimeouts: toNumber(situation.homeTimeouts),
    awayTimeouts: toNumber(situation.awayTimeouts),
    winProbability: homeWin !== null && awayWin !== null ? { home: homeWin, away: awayWin } : null,
  };
}

function eventLink(event, league, id) {
  const links = asArray(event.links);
  const summary = links.find((l) => asArray(l?.rel).includes('summary')) || links.find((l) => l?.href);
  if (summary?.href && /^https:\/\//.test(summary.href)) return summary.href;
  return `https://www.espn.com/${league === 'nfl' ? 'nfl' : 'college-football'}/game/_/gameId/${encodeURIComponent(id)}`;
}

function normalizeLeaders(competition, teams) {
  const categories = [];
  const add = (category, fallbackTeamId) => {
    const top = asArray(category?.leaders)[0];
    if (!top) return;
    const athlete = top.athlete || {};
    categories.push({
      category:
        text(category.displayName).replace(/\s+leader$/i, '') ||
        text(category.shortDisplayName) ||
        text(category.name),
      teamId: String(top.team?.id ?? athlete.team?.id ?? fallbackTeamId ?? ''),
      athlete: text(athlete.shortName) || text(athlete.displayName) || text(athlete.fullName),
      position: text(athlete.position?.abbreviation),
      value: text(top.displayValue),
    });
  };
  for (const category of asArray(competition.leaders)) add(category, null);
  if (!categories.length) {
    const raw = asArray(competition.competitors);
    for (const team of teams) {
      const competitor = raw.find((c) => String(c?.team?.id ?? c?.id) === team.id);
      for (const category of asArray(competitor?.leaders)) add(category, team.id);
    }
  }
  return categories.filter((c) => c.athlete && c.value);
}

export function normalizeRankings(raw) {
  const polls = [];
  for (const poll of asArray(raw?.rankings)) {
    const ranks = [];
    for (const entry of asArray(poll?.ranks)) {
      const rank = toNumber(entry?.current);
      const team = entry?.team || {};
      if (!rank || team.id === undefined || team.id === null) continue;
      const previous = toNumber(entry.previous);
      ranks.push({
        rank,
        previous: previous && previous > 0 ? previous : null,
        trend: text(entry.trend),
        points: toNumber(entry.points),
        firstPlaceVotes: toNumber(entry.firstPlaceVotes),
        record: text(entry.recordSummary) || text(entry.record?.summary),
        team: {
          id: String(team.id),
          abbr: text(team.abbreviation),
          name: text(team.shortDisplayName) || text(team.nickname) || text(team.location) || text(team.name),
          displayName: text(team.displayName) || [text(team.location), text(team.name)].filter(Boolean).join(' '),
          logo: team.logo || asArray(team.logos)[0]?.href || null,
          color: toColor(team.color),
        },
      });
    }
    if (!ranks.length) continue;
    ranks.sort((a, b) => a.rank - b.rank);
    polls.push({
      id: String(poll.id ?? poll.type ?? poll.name),
      type: text(poll.type).toLowerCase(),
      name: text(poll.name) || text(poll.shortName) || 'Poll',
      shortName: text(poll.shortName) || text(poll.name) || 'Poll',
      label: text(poll.occurrence?.displayValue),
      date: poll.date || null,
      ranks,
    });
  }
  return { polls };
}

/** Pick the poll ESPN uses for its own "curated" ranks: CFP once it exists, else AP. */
export function defaultPollId(polls) {
  const byType = (type) => polls.find((poll) => poll.type === type);
  return (byType('cfp') || byType('ap') || polls[0])?.id ?? null;
}

/** Collect conference names from a standings payload, walking nested groups. */
export function normalizeConferenceDirectory(raw) {
  const names = {};
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    for (const child of asArray(node.children)) {
      const id = child?.id;
      const name = text(child?.shortName) || text(child?.abbreviation) || text(child?.name).replace(/ Conference$/, '');
      if (id !== undefined && id !== null && name) {
        names[String(id)] = { name, fullName: text(child.name) || name };
      }
      visit(child, depth + 1);
    }
  };
  visit(raw, 0);
  return names;
}
