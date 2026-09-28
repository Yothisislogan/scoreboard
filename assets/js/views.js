// "Views" are the sidebar choices: all games, favorites, Top 25, a
// conference tier, a single conference or an NFL conference/division.

import {
  COLLEGE_TIERS,
  FBS_CONFERENCES,
  NFL_CONFERENCES,
  NFL_DIVISIONS,
  conferenceIdFromView,
  describeConference,
  fbsTier,
  isFbsConference,
  nflConferenceOfDivision,
  nflDivision,
  tierFromSlug,
} from './conferences.js';

const ALWAYS = () => true;

/**
 * Sidebar model: top-level items plus titled groups. A group with a `view`
 * is itself selectable (e.g. "Power 4" or "AFC").
 */
export function buildNav(league, { division = 'fbs', games = [], conference = describeConference } = {}) {
  const items = [
    { view: 'all', label: 'All games', icon: 'grid' },
    { view: 'favorites', label: 'Favorites', icon: 'star' },
  ];

  if (league === 'nfl') {
    const groups = NFL_CONFERENCES.map((conf) => ({
      view: conf.slug,
      label: conf.name,
      children: NFL_DIVISIONS.filter((d) => d.conference === conf.slug).map((d) => ({
        view: d.slug,
        label: d.name.replace(/^(AFC|NFC) /, ''),
        fullLabel: d.name,
      })),
    }));
    return { items, groups };
  }

  items.push(
    { view: 'top25', label: 'Top 25', icon: 'trophy' },
    { view: 'ranked', label: 'Ranked vs. ranked', icon: 'bolt' },
  );

  if (division === 'fcs') {
    const ids = new Set();
    for (const game of games) {
      for (const team of [game.away, game.home]) {
        if (team.conferenceId && !isFbsConference(team.conferenceId)) ids.add(team.conferenceId);
      }
    }
    const children = [...ids]
      .map((id) => {
        const info = conference(id);
        return { view: info.slug, label: info.name || `Conference ${id}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    return { items, division, groups: children.length ? [{ view: null, label: 'Conferences', children }] : [] };
  }

  const groups = ['power', 'group'].map((tier) => ({
    view: COLLEGE_TIERS[tier].slug,
    label: COLLEGE_TIERS[tier].label,
    children: FBS_CONFERENCES.filter((c) => c.tier === tier).map((c) => ({ view: c.slug, label: c.name })),
  }));
  const independents = FBS_CONFERENCES.find((c) => c.tier === 'independent');
  groups.push({ view: independents.slug, label: COLLEGE_TIERS.independent.label, children: [] });
  return { items, division, groups };
}

export function navViews(nav) {
  const views = nav.items.map((item) => item.view);
  for (const group of nav.groups) {
    if (group.view) views.push(group.view);
    for (const child of group.children) views.push(child.view);
  }
  return views;
}

function nflConference(team) {
  return team.division ? nflConferenceOfDivision(team.division) : null;
}

/** Predicate for a view, or null when the view doesn't exist for this league. */
export function viewPredicate(view, ctx) {
  if (view === 'all') return ALWAYS;
  if (view === 'favorites') return (game) => ctx.isFavorite(game);

  if (ctx.league === 'nfl') {
    if (NFL_CONFERENCES.some((c) => c.slug === view)) {
      return (game) => nflConference(game.away) === view || nflConference(game.home) === view;
    }
    if (nflDivision(view)) return (game) => game.away.division === view || game.home.division === view;
    return null;
  }

  if (view === 'top25') return (game) => Boolean(game.away.rank || game.home.rank);
  if (view === 'ranked') return (game) => Boolean(game.away.rank && game.home.rank);
  const tier = tierFromSlug(view);
  if (tier) return (game) => fbsTier(game.away.conferenceId) === tier || fbsTier(game.home.conferenceId) === tier;
  const conferenceId = conferenceIdFromView(view);
  if (conferenceId) {
    return (game) => game.away.conferenceId === conferenceId || game.home.conferenceId === conferenceId;
  }
  return null;
}

export function isValidView(view, league) {
  return viewPredicate(view, { league, isFavorite: () => false }) !== null;
}

/** Heading for the current view, e.g. "SEC" or "AFC East". */
export function viewTitle(view, league, conference = describeConference) {
  const fixed = { all: 'All games', favorites: 'Favorites', top25: 'Top 25', ranked: 'Ranked vs. ranked' };
  if (fixed[view]) return fixed[view];
  if (league === 'nfl') {
    return NFL_CONFERENCES.find((c) => c.slug === view)?.name || nflDivision(view)?.name || 'All games';
  }
  const tier = tierFromSlug(view);
  if (tier) return COLLEGE_TIERS[tier].label;
  const id = conferenceIdFromView(view);
  if (id) return conference(id)?.name || `Conference ${id}`;
  return 'All games';
}
