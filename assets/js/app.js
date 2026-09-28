// Wires data, state and rendering to the page.

import { fetchConferenceDirectory, fetchRankings, fetchScoreboard } from './api.js';
import { FCS_GROUP_ID, describeConference } from './conferences.js';
import { FAVORITES_KEY, createFavorites, safeStorage } from './favorites.js';
import { buildSections, computeFacets, filterGames, indexGamesByTeam } from './filters.js';
import { compactRange, pluralize, timeAgo } from './format.js';
import { ICONS } from './icons.js';
import { defaultPollId, normalizeConferenceDirectory, normalizeRankings, normalizeScoreboard } from './normalize.js';
import * as ui from './render.js';
import {
  GROUP_OPTIONS,
  LEAGUES,
  SORT_OPTIONS,
  buildHash,
  defaultLeague,
  formatWeekParam,
  loadSavedState,
  parseHash,
  parseWeekParam,
  sameWeek,
  sanitizePrefs,
  saveState,
  weekKey,
} from './state.js';
import { buildNav, isValidView, navViews, viewTitle } from './views.js';

const THEME_KEY = 'gridiron.theme';
const CONFERENCE_NAMES_KEY = 'gridiron.conferences.v1';
const SCORE_FLASH_MS = 6000;
const FIXED_VIEWS = ['all', 'favorites', 'top25', 'ranked'];

const storage = safeStorage();
const favorites = createFavorites(storage);

const state = {
  league: 'nfl',
  prefs: {},
  openGameId: null,
  pollId: null,
  optionsOpen: false,
};

const boards = new Map(); // data key -> { data, fetchedAt, error, pending }
const currentWeeks = new Map(); // scope key -> the week ESPN calls "current"
const calendars = new Map(); // scope key -> season calendar
const rankings = { polls: [], fetchedAt: 0, pending: null, error: null };
const conferenceNames = loadConferenceNames();
const lastScores = new Map();
const scoreChanges = new Map();
const htmlCache = new WeakMap();
const cardCache = new Map();
const headCache = new Map();

let directoryRequested = false;
let refreshTimer = 0;
let searchTimer = 0;
let renderQueued = false;
let gridSignature = '';
let lastView = null;
// True while the open game sheet has its own history entry, so Back closes it.
let dialogPushed = false;

const el = {};
const narrowScreen = window.matchMedia('(max-width: 640px)');

// ---------------------------------------------------------------- helpers

const activePrefs = () => state.prefs[state.league];
const scopeKey = (league, prefs) => `${league}|${league === 'college' ? prefs.division : 'all'}`;
const dataKey = (league, prefs) => `${scopeKey(league, prefs)}|${weekKey(prefs.week)}`;
const activeEntry = () => boards.get(dataKey(state.league, activePrefs()));

function setHTML(node, html) {
  if (htmlCache.get(node) === html) return;
  node.innerHTML = html;
  htmlCache.set(node, html);
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function loadConferenceNames() {
  try {
    const saved = JSON.parse(storage.getItem(CONFERENCE_NAMES_KEY) || 'null');
    if (saved?.names && typeof saved.names === 'object' && Date.now() - saved.savedAt < 30 * 86_400_000) {
      return { ...saved.names };
    }
  } catch {
    // Ignore unreadable cache.
  }
  return {};
}

function saveConferenceNames() {
  try {
    storage.setItem(CONFERENCE_NAMES_KEY, JSON.stringify({ savedAt: Date.now(), names: conferenceNames }));
  } catch {
    // Not essential.
  }
}

function context(league) {
  return {
    league,
    timeZone: undefined,
    now: Date.now(),
    isGameFavorite: (id) => favorites.isGame(id),
    isTeamFollowed: (teamLeague, id) => favorites.isTeam(teamLeague, id),
    isFavorite: (game) => favorites.isFavorite(game),
    conference: (id) => describeConference(id, conferenceNames),
    scoreChange: (id) => {
      const change = scoreChanges.get(id);
      return change && Date.now() - change.at < SCORE_FLASH_MS ? change : null;
    },
  };
}

// ------------------------------------------------------------ state flow

function validPrefs(league, prefs) {
  const next = sanitizePrefs(league, prefs);
  if (!isValidView(next.view, league)) next.view = 'all';
  if (next.week && sameWeek(next.week, currentWeeks.get(scopeKey(league, next)))) next.week = null;
  return next;
}

function syncHash(push = false) {
  const hash = buildHash(state.league, activePrefs(), { game: state.openGameId });
  if (hash === location.hash) return;
  const url = `${location.pathname}${location.search}${hash}`;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

function commit({ push = false } = {}) {
  saveState(storage, state.league, state.prefs);
  syncHash(push);
  requestRender();
}

function updatePrefs(patch, { push = false } = {}) {
  const league = state.league;
  const before = state.prefs[league];
  const next = validPrefs(league, { ...before, ...patch });
  state.prefs[league] = next;
  commit({ push });
  if (weekKey(before.week) !== weekKey(next.week) || before.division !== next.division) loadScoreboard();
}

function setLeague(league) {
  if (!LEAGUES.includes(league) || league === state.league) return;
  state.league = league;
  state.openGameId = null;
  commit({ push: true });
  loadScoreboard();
}

function applyHash(hash) {
  const parsed = parseHash(hash);
  if (!parsed) return false;
  dialogPushed = false;
  state.league = parsed.league;
  state.prefs[parsed.league] = validPrefs(parsed.league, parsed.prefs);
  state.openGameId = parsed.game;
  return true;
}

// --------------------------------------------------------------- loading

function trackScoreChanges(games) {
  const now = Date.now();
  let changed = false;
  for (const game of games) {
    const previous = lastScores.get(game.id);
    if (previous && game.state !== 'pre') {
      const away = previous.away !== null && previous.away !== game.away.score;
      const home = previous.home !== null && previous.home !== game.home.score;
      if (away || home) {
        scoreChanges.set(game.id, { away, home, at: now });
        changed = true;
      }
    }
    lastScores.set(game.id, { away: game.away.score, home: game.home.score });
  }
  if (changed) setTimeout(requestRender, SCORE_FLASH_MS + 100);
}

async function ensureConferenceNames(data) {
  for (const [id, info] of Object.entries(data.conferenceNames)) {
    if (!conferenceNames[id]) conferenceNames[id] = info;
  }
  if (directoryRequested || data.league !== 'college' || data.division !== 'fcs') return;
  const missing = data.games.some((game) =>
    [game.away, game.home].some((team) => team.conferenceId && !describeConference(team.conferenceId, conferenceNames)?.name),
  );
  if (!missing) return;
  directoryRequested = true;
  try {
    const raw = await fetchConferenceDirectory(FCS_GROUP_ID, data.season.year);
    Object.assign(conferenceNames, normalizeConferenceDirectory(raw));
    saveConferenceNames();
    requestRender();
  } catch {
    // Conference names stay generic.
  }
}

function loadRankings({ force = false } = {}) {
  if (rankings.pending) return;
  if (!force && rankings.fetchedAt && Date.now() - rankings.fetchedAt < 20 * 60_000) return;
  rankings.pending = fetchRankings()
    .then((raw) => {
      // The FBS panel only shows FBS polls.
      rankings.polls = normalizeRankings(raw).polls.filter((poll) => !/\bFCS\b|division ii|\bD-?II\b|naia/i.test(poll.name));
      rankings.error = null;
      rankings.fetchedAt = Date.now();
      if (!rankings.polls.some((poll) => poll.id === state.pollId)) state.pollId = defaultPollId(rankings.polls);
    })
    .catch((error) => {
      rankings.error = error;
      rankings.fetchedAt = Date.now() - 15 * 60_000; // retry in about five minutes
    })
    .finally(() => {
      rankings.pending = null;
      requestRender();
    });
  requestRender();
}

function weekContaining(calendar, time) {
  const week = calendar.find((w) => Date.parse(w.startDate) <= time && time <= Date.parse(w.endDate));
  return week ? { year: week.year, seasonType: week.seasonType, week: week.week } : null;
}

function loadScoreboard({ force = false } = {}) {
  const league = state.league;
  const prefs = activePrefs();
  const key = dataKey(league, prefs);
  if (league === 'college' && prefs.division === 'fbs') loadRankings();

  let entry = boards.get(key);
  if (!entry) {
    entry = { data: null, fetchedAt: 0, error: null, pending: null };
    boards.set(key, entry);
  }
  if (entry.pending) return entry.pending;
  if (!force && entry.data && Date.now() - entry.fetchedAt < 20_000) {
    scheduleRefresh();
    return Promise.resolve();
  }

  const scope = scopeKey(league, prefs);
  const division = league === 'college' ? prefs.division : null;
  entry.pending = fetchScoreboard(league, { division: prefs.division, week: prefs.week })
    .then((raw) => {
      const data = normalizeScoreboard(raw, { league, division });
      trackScoreChanges(data.games);
      entry.data = data;
      entry.error = null;
      entry.fetchedAt = Date.now();
      if (!prefs.week && data.week) currentWeeks.set(scope, data.week);
      if (data.calendar.length) calendars.set(scope, data.calendar);
      // Opened straight onto another week: work out which one is current from the dates.
      if (!currentWeeks.has(scope)) {
        const current = weekContaining(data.calendar, Date.now());
        if (current) currentWeeks.set(scope, current);
      }
      for (const game of data.games) {
        if (favorites.isGame(game.id)) favorites.refreshGame(game, division ? { division } : {});
      }
      ensureConferenceNames(data);
    })
    .catch((error) => {
      entry.error = error;
    })
    .finally(() => {
      entry.pending = null;
      requestRender();
      if (key === dataKey(state.league, activePrefs())) scheduleRefresh();
    });
  requestRender();
  return entry.pending;
}

/** Poll quickly while games are live, slowly when nothing is happening. */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (document.hidden) return;
  const entry = activeEntry();
  const games = entry?.data?.games || [];
  const now = Date.now();
  let delay = 5 * 60_000;
  if (games.some((game) => game.state === 'in')) {
    delay = 30_000;
  } else if (
    games.some((game) => {
      if (game.state !== 'pre' || !game.timeValid || game.postponed || game.canceled) return false;
      const untilKickoff = Date.parse(game.date) - now;
      return untilKickoff < 20 * 60_000 && untilKickoff > -6 * 3_600_000;
    })
  ) {
    delay = 60_000;
  } else if (games.length && games.every((game) => game.state === 'post')) {
    delay = 30 * 60_000;
  }
  if (entry?.error) delay = Math.min(delay, 30_000);
  refreshTimer = setTimeout(() => loadScoreboard({ force: true }), delay);
}

// -------------------------------------------------------------- rendering

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const league = state.league;
  const prefs = activePrefs();
  const entry = activeEntry();
  const data = entry?.data || null;
  const games = data?.games || [];
  const ctx = context(league);

  const nav = buildNav(league, { division: prefs.division, games, conference: ctx.conference });
  const facets = computeFacets(games, prefs, ctx, navViews(nav));
  const filtered = filterGames(games, prefs, ctx);
  const sections = buildSections(filtered, prefs, ctx);

  document.documentElement.dataset.league = league;
  renderLeagueSwitch(league);
  renderHead(league, prefs, data, entry, ctx);
  renderWeekNav(league, prefs, data, entry);
  setHTML(el.sidebar, ui.renderNav(nav, facets, prefs.view));
  if (lastView !== `${league}:${prefs.view}`) {
    lastView = `${league}:${prefs.view}`;
    revealActiveNavItem();
  }
  renderToolbar(league, prefs, facets);
  renderSummary(prefs, filtered.length, games.length, data);
  setHTML(
    el.banner,
    entry?.error && data
      ? ui.renderBanner({
          message: `Couldn't refresh scores. Showing results from ${timeAgo(entry.fetchedAt)}.`,
          action: { action: 'refresh', label: 'Retry' },
        })
      : '',
  );
  renderFavoritesPanel(league, prefs, games, ctx);
  renderGames(entry, data, sections, filtered, prefs, facets, ctx);
  setHTML(el.byes, league === 'nfl' && data && prefs.view === 'all' ? ui.renderByes(data.byes) : '');
  renderRail(league, prefs, games, ctx);
  renderDialog(games, ctx, entry);
  renderUpdated();
  document.title = facets.live.all ? `(${facets.live.all} live) Gridiron Scoreboard` : 'Gridiron Scoreboard';
}

function renderLeagueSwitch(league) {
  for (const button of document.querySelectorAll('[data-action="league"]')) {
    const active = button.dataset.league === league;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function displayedWeek(league, prefs, data) {
  const scope = scopeKey(league, prefs);
  const target = prefs.week || data?.week || currentWeeks.get(scope);
  if (!target) return null;
  const calendar = calendars.get(scope) || data?.calendar || [];
  return calendar.find((week) => sameWeek(week, target)) || { ...target, label: `Week ${target.week}`, detail: '' };
}

function renderHead(league, prefs, data, entry, ctx) {
  setText(el.pageEyebrow, league === 'nfl' ? 'NFL' : `College football · ${prefs.division.toUpperCase()}`);
  setText(el.pageTitle, viewTitle(prefs.view, league, ctx.conference));
  const week = displayedWeek(league, prefs, data);
  let sub = entry?.error && !data ? 'Scores unavailable right now' : 'Loading schedule…';
  if (week) {
    sub = [week.label, compactRange(week.detail), data ? pluralize(data.games.length, 'game') : '']
      .filter(Boolean)
      .join(' · ');
  }
  setText(el.pageSub, sub);
}

function renderWeekNav(league, prefs, data, entry) {
  const scope = scopeKey(league, prefs);
  const calendar = calendars.get(scope) || [];
  const current = currentWeeks.get(scope) || null;
  const shown = prefs.week || current || data?.week || null;
  const selected = shown ? formatWeekParam(shown) : '';
  const options = calendar.length
    ? ui.renderWeekOptions(calendar, selected, current ? formatWeekParam(current) : '', { compact: narrowScreen.matches })
    : `<option value="">${shown ? `Week ${shown.week}` : entry?.pending ? 'Loading…' : 'Week'}</option>`;
  setHTML(el.weekSelect, options);
  if (calendar.length && el.weekSelect.value !== selected) el.weekSelect.value = selected;
  el.weekSelect.disabled = !calendar.length;
  const index = calendar.findIndex((week) => sameWeek(week, shown));
  el.weekPrev.disabled = index <= 0;
  el.weekNext.disabled = index === -1 || index >= calendar.length - 1;
  el.weekCurrent.hidden = !prefs.week;
}

function renderToolbar(league, prefs, facets) {
  if (document.activeElement !== el.search && el.search.value !== prefs.query) el.search.value = prefs.query;
  el.searchClear.hidden = !el.search.value;
  setHTML(el.statusTabs, ui.renderStatusTabs(facets.statuses, prefs.status));

  const networks = [...facets.networks.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (prefs.network && !facets.networks.has(prefs.network)) networks.push([prefs.network, 0]);
  setHTML(
    el.networkSelect,
    ui.renderSelectOptions(
      [{ value: '', label: 'All networks' }, ...networks.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))],
      prefs.network,
    ),
  );
  if (el.networkSelect.value !== prefs.network) el.networkSelect.value = prefs.network;
  setHTML(el.groupSelect, ui.renderSelectOptions(GROUP_OPTIONS[league], prefs.groupBy));
  if (el.groupSelect.value !== prefs.groupBy) el.groupSelect.value = prefs.groupBy;
  setHTML(el.sortSelect, ui.renderSelectOptions(SORT_OPTIONS, prefs.sortBy));
  if (el.sortSelect.value !== prefs.sortBy) el.sortSelect.value = prefs.sortBy;

  el.options.classList.toggle('is-open', state.optionsOpen);
  el.optionsToggle.setAttribute('aria-expanded', String(state.optionsOpen));
  const active = [prefs.network, prefs.groupBy !== GROUP_OPTIONS[league][0].value, prefs.sortBy !== 'time'].filter(Boolean).length;
  setText(el.optionsCount, active ? String(active) : '');
}

function renderSummary(prefs, shown, total, data) {
  const narrowed = prefs.status !== 'all' || prefs.query || prefs.network;
  if (!data || !narrowed) return setHTML(el.resultSummary, '');
  setHTML(
    el.resultSummary,
    `${ui.esc(`Showing ${shown} of ${pluralize(total, 'game')}`)} ` +
      '<button type="button" class="link-btn" data-action="reset-filters">Clear filters</button>',
  );
}

function renderFavoritesPanel(league, prefs, games, ctx) {
  if (prefs.view !== 'favorites') return setHTML(el.favoritesPanel, '');
  const onScreen = new Set(games.map((game) => game.id));
  const now = Date.now();
  const saved = favorites
    .games(league)
    .filter((game) => !onScreen.has(game.id) && Date.parse(game.date) > now - 6 * 3_600_000)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  setHTML(el.favoritesPanel, ui.renderFavoritesPanel({ teams: favorites.teams(league), saved, ctx }));
}

function showGridMessage(html) {
  const signature = `message:${html}`;
  if (gridSignature === signature) return;
  el.games.innerHTML = html;
  gridSignature = signature;
  cardCache.clear();
  headCache.clear();
}

function emptyState(prefs, facets, ctx) {
  const narrowed = prefs.status !== 'all' || prefs.query || prefs.network;
  if (prefs.view === 'favorites' && !narrowed) {
    return ui.renderEmpty({
      icon: 'star',
      title: 'No favorites this week',
      body: 'Tap the star on any game to pin it here, or follow a team from its game details to see every game it plays.',
      actions: [{ action: 'show-all', label: 'Browse all games', primary: true }],
    });
  }
  const actions = [];
  if (narrowed) actions.push({ action: 'reset-filters', label: 'Clear filters', primary: true });
  if (prefs.view !== 'all' && facets.views.all > 0) {
    actions.push({ action: 'show-all', label: `See ${pluralize(facets.views.all, 'match', 'matches')} in all games` });
  }
  const title = narrowed
    ? 'No games match your filters'
    : `No ${viewTitle(prefs.view, ctx.league, ctx.conference)} games this week`;
  return ui.renderEmpty({
    icon: narrowed ? 'search' : 'calendar',
    title,
    body: narrowed ? 'Try a different search or status.' : 'Try another week or group.',
    actions,
  });
}

function focusedCardControl() {
  const active = document.activeElement;
  const card = active?.closest?.('[data-key]');
  if (!card || !el.games.contains(card)) return null;
  return { key: card.dataset.key, action: active.dataset.action || '' };
}

function restoreCardFocus(focus) {
  if (!focus) return;
  const selector = `[data-key="${CSS.escape(focus.key)}"] [data-action="${CSS.escape(focus.action)}"]`;
  el.games.querySelector(selector)?.focus({ preventScroll: true });
}

/**
 * Patch the game grid in place: when the set and order of games is the same,
 * only cards whose markup changed are swapped, so refreshes don't flicker.
 */
function patchSections(sections, ctx) {
  const built = sections.map((section) => ({
    key: section.key,
    head: ui.renderSectionHead(section),
    cards: section.games.map((game) => ({ key: game.id, html: ui.renderCard(game, ctx, { showDay: section.showDay }) })),
  }));
  const signature = built.map((s) => `${s.key}:${s.cards.map((c) => c.key).join(',')}`).join('|');

  if (signature !== gridSignature) {
    const focus = focusedCardControl();
    el.games.innerHTML = built
      .map(
        (s) =>
          `<section class="games-section" data-section="${ui.esc(s.key)}">${s.head}` +
          `<div class="card-grid">${s.cards.map((c) => c.html).join('')}</div></section>`,
      )
      .join('');
    gridSignature = signature;
    cardCache.clear();
    headCache.clear();
    for (const s of built) {
      headCache.set(s.key, s.head);
      for (const c of s.cards) cardCache.set(c.key, c.html);
    }
    restoreCardFocus(focus);
    return;
  }

  for (const s of built) {
    const sectionEl = el.games.querySelector(`[data-section="${CSS.escape(s.key)}"]`);
    if (!sectionEl) continue;
    if (headCache.get(s.key) !== s.head) {
      const head = sectionEl.querySelector(':scope > .section-head');
      if (head) head.outerHTML = s.head;
      else sectionEl.insertAdjacentHTML('afterbegin', s.head);
      headCache.set(s.key, s.head);
    }
    for (const c of s.cards) {
      if (cardCache.get(c.key) === c.html) continue;
      const card = sectionEl.querySelector(`[data-key="${CSS.escape(c.key)}"]`);
      if (!card) continue;
      const focus = card.contains(document.activeElement) ? focusedCardControl() : null;
      card.outerHTML = c.html;
      cardCache.set(c.key, c.html);
      restoreCardFocus(focus);
    }
  }
}

function renderGames(entry, data, sections, filtered, prefs, facets, ctx) {
  if (!data) {
    if (entry?.error) {
      showGridMessage(
        ui.renderEmpty({
          icon: 'refresh',
          title: "Couldn't load scores",
          body: 'The score service didn’t respond. Check your connection and try again.',
          actions: [{ action: 'refresh', label: 'Try again', primary: true }],
        }),
      );
    } else {
      showGridMessage(ui.renderSkeleton(6));
    }
    return;
  }
  if (!data.games.length) {
    showGridMessage(
      ui.renderEmpty({
        icon: 'calendar',
        title: 'No games scheduled this week',
        body: 'Use the week menu to look at another week.',
        actions: prefs.week ? [{ action: 'week-current', label: 'Back to this week', primary: true }] : [],
      }),
    );
    return;
  }
  if (!filtered.length) {
    showGridMessage(emptyState(prefs, facets, ctx));
    return;
  }
  patchSections(sections, ctx);
}

function renderRail(league, prefs, games, ctx) {
  const show = league === 'college' && prefs.division === 'fbs';
  el.layout.classList.toggle('has-rail', show);
  if (!show) return setHTML(el.rail, '');
  setHTML(
    el.rail,
    ui.renderRankings({
      polls: rankings.polls,
      pollId: state.pollId,
      gamesByTeam: indexGamesByTeam(games),
      ctx,
      loading: Boolean(rankings.pending),
      error: rankings.error,
    }),
  );
}

function renderDialog(games, ctx, entry) {
  const dialog = el.dialog;
  if (!state.openGameId) {
    if (dialog.open) dialog.close();
    return;
  }
  const game = games.find((g) => g.id === state.openGameId);
  if (!game) {
    // The game isn't in this week's data (stale link): drop it once data has loaded.
    if (entry?.data && !entry.pending) {
      state.openGameId = null;
      syncHash();
      if (dialog.open) dialog.close();
    }
    return;
  }
  const active = dialog.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = active ? `${active.dataset.action || ''}|${active.dataset.teamId || ''}` : null;
  const scrollTop = el.dialogBody.scrollTop;
  setHTML(el.dialogBody, ui.renderGameDetail(game, ctx));
  if (dialog.open && el.dialogBody.scrollTop !== scrollTop) el.dialogBody.scrollTop = scrollTop;
  if (!dialog.open) {
    dialog.showModal();
    el.dialogBody.scrollTop = 0;
  } else if (focusKey && !dialog.contains(document.activeElement)) {
    const [action, teamId] = focusKey.split('|');
    const selector = `[data-action="${CSS.escape(action)}"]${teamId ? `[data-team-id="${CSS.escape(teamId)}"]` : ''}`;
    el.dialogBody.querySelector(selector)?.focus({ preventScroll: true });
  }
}

function renderUpdated() {
  const entry = activeEntry();
  let text = '';
  if (entry?.pending) text = entry.data ? 'Updating…' : 'Loading…';
  else if (entry?.error && !entry.data) text = 'Offline';
  else if (entry?.fetchedAt) text = `Updated ${timeAgo(entry.fetchedAt)}`;
  setText(el.updated, text);
  el.refreshBtn.classList.toggle('is-spinning', Boolean(entry?.pending));
}

function revealActiveNavItem() {
  const sidebar = el.sidebar;
  if (sidebar.scrollWidth <= sidebar.clientWidth + 4) return;
  const active = sidebar.querySelector('.is-active');
  if (!active) return;
  const left = active.offsetLeft - sidebar.clientWidth / 2 + active.offsetWidth / 2;
  sidebar.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function scrollToContent() {
  const top = el.layout.getBoundingClientRect().top + window.scrollY - 72;
  if (window.scrollY > top) window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// ----------------------------------------------------------------- actions

function findGame(id) {
  return activeEntry()?.data?.games.find((game) => game.id === id) || null;
}

function toggleFavorite(id) {
  const game = findGame(id);
  if (game) {
    favorites.toggleGame(game, game.league === 'college' ? { division: activePrefs().division } : {});
    return;
  }
  const saved = favorites.games().find((g) => g.id === id);
  if (saved) favorites.toggleGame(saved);
}

function toggleFollow(gameId, teamId) {
  const game = findGame(gameId);
  const team = game && [game.away, game.home].find((t) => t.id === teamId);
  if (team) favorites.toggleTeam(game.league, team);
}

function gotoFavorite(id) {
  const saved = favorites.games().find((game) => game.id === id);
  if (!saved) return;
  const league = saved.league;
  const patch = { ...state.prefs[league], view: 'favorites', status: 'all', query: '', network: '', week: saved.week };
  if (league === 'college' && saved.division) patch.division = saved.division;
  state.league = league;
  state.prefs[league] = validPrefs(league, patch);
  state.openGameId = id;
  commit({ push: true });
  loadScoreboard();
}

function changeDivision(division) {
  if (state.league !== 'college' || division === activePrefs().division) return;
  const patch = { division };
  // Conference views don't carry over between FBS and FCS.
  if (!FIXED_VIEWS.includes(activePrefs().view)) patch.view = 'all';
  updatePrefs(patch, { push: true });
}

function stepWeek(delta) {
  const prefs = activePrefs();
  const scope = scopeKey(state.league, prefs);
  const calendar = calendars.get(scope) || [];
  const shown = prefs.week || currentWeeks.get(scope);
  const index = calendar.findIndex((week) => sameWeek(week, shown));
  const next = index === -1 ? null : calendar[index + delta];
  if (next) updatePrefs({ week: { year: next.year, seasonType: next.seasonType, week: next.week } }, { push: true });
}

function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeButton() {
  const dark = currentTheme() === 'dark';
  el.themeBtn.innerHTML = dark ? ICONS.sun : ICONS.moon;
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  el.themeBtn.setAttribute('aria-label', label);
  el.themeBtn.title = label;
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    storage.setItem(THEME_KEY, next);
  } catch {
    // Theme just won't persist.
  }
  updateThemeButton();
}

// ------------------------------------------------------------------ events

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const { action } = target.dataset;
  switch (action) {
    case 'home':
      event.preventDefault();
      updatePrefs({ view: 'all', status: 'all', query: '', network: '', week: null }, { push: true });
      break;
    case 'league':
      setLeague(target.dataset.league);
      break;
    case 'view':
      updatePrefs({ view: target.dataset.view }, { push: true });
      scrollToContent();
      break;
    case 'status':
      updatePrefs({ status: target.dataset.status });
      break;
    case 'toggle-favorite':
      toggleFavorite(target.dataset.id);
      break;
    case 'toggle-follow':
      toggleFollow(target.dataset.gameId, target.dataset.teamId);
      break;
    case 'unfollow':
      favorites.toggleTeam(state.league, { id: target.dataset.teamId });
      break;
    case 'open-game':
      if (state.openGameId === target.dataset.id) break;
      state.openGameId = target.dataset.id;
      dialogPushed = true;
      syncHash(true);
      render();
      break;
    case 'close-dialog':
      el.dialog.close();
      break;
    case 'goto-favorite':
      gotoFavorite(target.dataset.id);
      break;
    case 'week-prev':
      stepWeek(-1);
      break;
    case 'week-next':
      stepWeek(1);
      break;
    case 'week-current':
      updatePrefs({ week: null }, { push: true });
      break;
    case 'refresh':
      loadScoreboard({ force: true });
      if (state.league === 'college' && activePrefs().division === 'fbs') loadRankings({ force: true });
      break;
    case 'theme':
      toggleTheme();
      break;
    case 'clear-search':
      el.search.value = '';
      updatePrefs({ query: '' });
      el.search.focus();
      break;
    case 'reset-filters':
      el.search.value = '';
      updatePrefs({ status: 'all', query: '', network: '' });
      break;
    case 'show-all':
      updatePrefs({ view: 'all' }, { push: true });
      break;
    case 'division':
      changeDivision(target.dataset.division);
      break;
    case 'toggle-options':
      state.optionsOpen = !state.optionsOpen;
      requestRender();
      break;
    default:
      break;
  }
}

function onChange(event) {
  const control = event.target.dataset?.control;
  if (!control) return;
  const { value } = event.target;
  switch (control) {
    case 'week':
      updatePrefs({ week: parseWeekParam(value) }, { push: true });
      break;
    case 'network':
      updatePrefs({ network: value });
      break;
    case 'group':
      updatePrefs({ groupBy: value });
      break;
    case 'sort':
      updatePrefs({ sortBy: value });
      break;
    case 'poll':
      state.pollId = value;
      requestRender();
      break;
    default:
      break;
  }
}

function onSearchInput() {
  el.searchClear.hidden = !el.search.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => updatePrefs({ query: el.search.value.trim() }), 120);
}

function onSearchKeydown(event) {
  if (event.key === 'Escape' && el.search.value) {
    event.preventDefault();
    el.search.value = '';
    updatePrefs({ query: '' });
  } else if (event.key === 'Enter') {
    clearTimeout(searchTimer);
    updatePrefs({ query: el.search.value.trim() });
  }
}

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function onKeydown(event) {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTyping(event.target) || el.dialog.open) return;
  event.preventDefault();
  el.search.focus();
  el.search.select();
}

function onImageError(event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo')) return;
  const original = img.dataset.src;
  if (original && img.src !== original && !img.dataset.retried) {
    img.dataset.retried = '1';
    img.src = original;
    return;
  }
  ui.markLogoFailed(original);
  img.outerHTML = ui.renderLogoBadge(img.dataset.abbr || '?', img.dataset.color, img.dataset.size, img.className);
}

function onHistory() {
  if (location.hash === buildHash(state.league, activePrefs(), { game: state.openGameId })) return;
  if (!applyHash(location.hash)) return;
  requestRender();
  loadScoreboard();
}

function onVisibility() {
  if (document.hidden) {
    clearTimeout(refreshTimer);
    return;
  }
  const entry = activeEntry();
  if (!entry?.fetchedAt || Date.now() - entry.fetchedAt > 30_000) loadScoreboard({ force: true });
  else scheduleRefresh();
}

function onDialogClose() {
  if (!state.openGameId) return;
  const id = state.openGameId;
  state.openGameId = null;
  if (dialogPushed) {
    dialogPushed = false;
    history.back();
  } else {
    syncHash();
  }
  el.games.querySelector(`[data-key="${CSS.escape(id)}"] .game__hit`)?.focus({ preventScroll: true });
}

// -------------------------------------------------------------------- boot

function collectElements() {
  const ids = {
    layout: 'layout',
    pageEyebrow: 'page-eyebrow',
    pageTitle: 'page-title',
    pageSub: 'page-sub',
    weekSelect: 'week-select',
    weekPrev: 'week-prev',
    weekNext: 'week-next',
    weekCurrent: 'week-current',
    sidebar: 'sidebar',
    search: 'search',
    searchClear: 'search-clear',
    statusTabs: 'status-tabs',
    options: 'options',
    optionsToggle: 'options-toggle',
    optionsCount: 'options-count',
    networkSelect: 'network-select',
    groupSelect: 'group-select',
    sortSelect: 'sort-select',
    resultSummary: 'result-summary',
    banner: 'banner',
    favoritesPanel: 'favorites-panel',
    games: 'games',
    byes: 'byes',
    rail: 'rail',
    updated: 'updated',
    refreshBtn: 'refresh-btn',
    themeBtn: 'theme-btn',
    dialog: 'game-dialog',
    dialogBody: 'dialog-body',
    timeZone: 'time-zone',
  };
  for (const [name, id] of Object.entries(ids)) el[name] = document.getElementById(id);
}

function init() {
  collectElements();
  for (const node of document.querySelectorAll('[data-icon]')) {
    node.insertAdjacentHTML('afterbegin', ICONS[node.dataset.icon] || '');
  }

  const saved = loadSavedState(storage);
  state.league = saved.league || defaultLeague();
  for (const league of LEAGUES) state.prefs[league] = validPrefs(league, saved.prefs[league]);
  applyHash(location.hash);
  syncHash();

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) el.timeZone.textContent = ` (${zone.replace(/_/g, ' ')})`;
  } catch {
    // Leave it generic.
  }

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('error', onImageError, true);
  document.addEventListener('visibilitychange', onVisibility);
  el.search.addEventListener('input', onSearchInput);
  el.search.addEventListener('keydown', onSearchKeydown);
  el.dialog.addEventListener('close', onDialogClose);
  el.dialog.addEventListener('click', (event) => {
    if (event.target === el.dialog) el.dialog.close();
  });
  window.addEventListener('popstate', onHistory);
  window.addEventListener('hashchange', onHistory);
  window.addEventListener('storage', (event) => {
    if (event.key === FAVORITES_KEY) favorites.reload();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeButton);
  favorites.subscribe(requestRender);

  const wide = window.matchMedia('(min-width: 720px)');
  const setPlaceholder = () => {
    el.search.placeholder = wide.matches ? 'Search teams — try “Georgia vs Alabama”' : 'Search teams';
  };
  wide.addEventListener('change', setPlaceholder);
  narrowScreen.addEventListener('change', requestRender);
  setPlaceholder();

  updateThemeButton();
  render();
  loadScoreboard();
  setInterval(renderUpdated, 1000);
  setInterval(requestRender, 60_000);
}

init();
