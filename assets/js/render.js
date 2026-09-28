// HTML builders. Each function returns a string; app.js decides where it
// goes. Every value that came from the network passes through esc().

import { STATUS_FILTERS } from './filters.js';
import {
  ESPN_TIME_ZONE,
  compactRange,
  formatKickoff,
  formatShortDate,
  formatTime,
  formatWeekday,
  formatWeekdayTime,
  gameStatus,
  periodLabel,
  pluralize,
} from './format.js';
import { ICONS } from './icons.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

const LIVE_DOT = '<span class="live-dot" aria-hidden="true"></span>';
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;
const NEUTRAL = '#64748b';

export function safeColor(value, fallback = NEUTRAL) {
  return SAFE_COLOR.test(value || '') ? value : fallback;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function badgeTextColor(hex) {
  return luminance(safeColor(hex)) > 0.22 ? '#0f172a' : '#ffffff';
}

/** Team color for the card's top stripe; near-white colors fall back to the alternate. */
function stripeColor(team) {
  const primary = safeColor(team.color, '');
  if (primary && luminance(primary) < 0.8) return primary;
  const alternate = safeColor(team.altColor, '');
  if (alternate && luminance(alternate) < 0.8) return alternate;
  return '#94a3b8';
}

// ESPN's image service resizes logos on the fly, which keeps a 60-game
// slate from downloading 500px PNGs.
const ESPN_IMAGE = /^https:\/\/a\.espncdn\.com(\/i\/[\w\-/.]+\.png)$/i;

export function logoSrc(url, px) {
  const match = ESPN_IMAGE.exec(url || '');
  return match ? `https://a.espncdn.com/combiner/i?img=${match[1]}&w=${px}&h=${px}` : url;
}

// Logos that failed to load render as badges from then on, so live
// refreshes don't keep retrying them.
const failedLogos = new Set();

export function markLogoFailed(url) {
  if (url) failedLogos.add(url);
}

function shortCode(team) {
  return String(team.abbr || team.name || '?').slice(0, 4).toUpperCase();
}

export function renderLogoBadge(abbr, color, size, className = 'logo') {
  const background = safeColor(color);
  const px = Number(size) || 28;
  const text = String(abbr || '?');
  const scale = text.length >= 4 ? 0.25 : text.length === 3 ? 0.3 : 0.36;
  return (
    `<span class="${esc(className)} logo--badge" style="--logo-bg:${background};` +
    `--logo-fg:${badgeTextColor(background)};--logo-size:${px}px;--logo-font:${(px * scale).toFixed(1)}px" ` +
    `aria-hidden="true">${esc(text)}</span>`
  );
}

export function renderLogo(team, size = 28, extraClass = '') {
  const className = extraClass ? `logo ${extraClass}` : 'logo';
  const abbr = shortCode(team);
  if (!team.logo || failedLogos.has(team.logo)) return renderLogoBadge(abbr, team.color, size, className);
  return (
    `<img class="${esc(className)}" src="${esc(logoSrc(team.logo, size * 2))}" data-src="${esc(team.logo)}" ` +
    `data-abbr="${esc(abbr)}" data-color="${esc(safeColor(team.color))}" data-size="${size}" ` +
    `width="${size}" height="${size}" alt="" loading="lazy" decoding="async">`
  );
}

function venueLine(venue) {
  if (!venue) return '';
  const place = [venue.city, venue.state].filter(Boolean).join(', ');
  return place || venue.name || '';
}

function renderStarButton(game, active) {
  const label = active ? `Remove ${game.shortName} from favorites` : `Save ${game.shortName} to favorites`;
  return (
    `<button type="button" class="star-btn${active ? ' is-active' : ''}" data-action="toggle-favorite" ` +
    `data-id="${esc(game.id)}" aria-pressed="${active}" aria-label="${esc(label)}" ` +
    `title="${active ? 'Remove from favorites' : 'Favorite this matchup'}">${ICONS.star}</button>`
  );
}

function outcome(game, team) {
  const other = team === game.away ? game.home : game.away;
  const decided =
    game.state === 'post' && !game.postponed && !game.canceled && team.score !== null && other.score !== null;
  if (!decided) return '';
  if (team.winner || (!other.winner && team.score > other.score)) return 'won';
  if (other.winner || team.score < other.score) return 'lost';
  return '';
}

function renderTeamRow(game, team, ctx, scoreChanged) {
  const result = outcome(game, team);
  const hasBall = game.state === 'in' && game.situation?.possession === team.id;
  const followed = ctx.isTeamFollowed(game.league, team.id);
  return (
    `<div class="team${result === 'won' ? ' is-winner' : ''}${result === 'lost' ? ' is-loser' : ''}">` +
    renderLogo(team, 28, 'team__logo') +
    `<span class="team__name">${team.rank ? `<span class="rank">${team.rank}</span>` : ''}` +
    `<span class="team__label">${esc(team.name)}</span></span>` +
    (hasBall ? `<span class="possession" title="${esc(team.name)} has the ball">${ICONS.ball}</span>` : '') +
    (followed ? `<span class="team__follow" title="You follow ${esc(team.name)}">${ICONS.heart}</span>` : '') +
    (team.record ? `<span class="team__record">${esc(team.record)}</span>` : '') +
    `<span class="team__score${scoreChanged ? ' is-changed' : ''}">${team.score ?? ''}</span>` +
    `</div>`
  );
}

function renderCardFooter(game) {
  const bits = [];
  let live = false;
  if (game.state === 'in') {
    const situation = game.situation;
    const down = situation?.downDistance || situation?.shortDownDistance;
    if (down) bits.push(esc(down));
    if (situation?.isRedZone) bits.push('<span class="chip chip--redzone">Red zone</span>');
    live = true;
  } else if (game.state === 'pre' && !game.postponed && !game.canceled) {
    if (game.odds?.details) bits.push(esc(game.odds.details));
    if (game.odds?.overUnder !== null && game.odds?.overUnder !== undefined) bits.push(`O/U ${esc(game.odds.overUnder)}`);
    if (!bits.length && game.venue) bits.push(esc(venueLine(game.venue)));
  }
  if (!bits.length) return '';
  return `<div class="game__foot${live ? ' game__foot--live' : ''}">${bits.map((b) => `<span>${b}</span>`).join('')}</div>`;
}

export function renderCard(game, ctx, { showDay = false } = {}) {
  const favorite = ctx.isGameFavorite(game.id);
  const followed = ctx.isTeamFollowed(game.league, game.away.id) || ctx.isTeamFollowed(game.league, game.home.id);
  const status = gameStatus(game, { showDay, timeZone: ctx.timeZone });
  const change = ctx.scoreChange ? ctx.scoreChange(game.id) : null;
  const classes = ['game', `game--${game.state}`];
  if (status.tone === 'muted') classes.push('game--off');
  if (favorite) classes.push('is-favorite');
  if (followed) classes.push('is-followed');
  if (change) classes.push('is-changed');
  const score = (team) => (team.score !== null ? ` ${team.score}` : '');
  const summary = `${game.away.name}${score(game.away)} at ${game.home.name}${score(game.home)}, ${status.text}`;
  const networks = game.broadcasts.slice(0, 2).join(' · ');
  return (
    `<article class="${classes.join(' ')}" data-key="${esc(game.id)}" ` +
    `style="--away:${stripeColor(game.away)};--home:${stripeColor(game.home)}">` +
    `<button type="button" class="game__hit" data-action="open-game" data-id="${esc(game.id)}" ` +
    `aria-label="${esc(summary)}. Show details"></button>` +
    `<div class="game__top"><span class="status status--${status.tone}">` +
    `${status.tone === 'live' ? LIVE_DOT : ''}${esc(status.text)}</span>` +
    (networks ? `<span class="game__tv" title="${esc(game.broadcasts.join(', '))}">${esc(networks)}</span>` : '') +
    renderStarButton(game, favorite) +
    `</div>` +
    (game.note ? `<p class="game__note">${esc(game.note)}</p>` : '') +
    renderTeamRow(game, game.away, ctx, change?.away) +
    renderTeamRow(game, game.home, ctx, change?.home) +
    renderCardFooter(game) +
    `</article>`
  );
}

export function renderSectionHead(section) {
  if (!section.title) return '';
  const icon =
    section.kind === 'live'
      ? LIVE_DOT
      : section.kind === 'favorites'
        ? ICONS.star
        : section.kind === 'top25'
          ? ICONS.trophy
          : '';
  return (
    `<header class="section-head section-head--${esc(section.kind)}">` +
    `<h2 class="section-head__title">${icon}<span>${esc(section.title)}</span></h2>` +
    (section.eyebrow ? `<span class="section-head__tag">${esc(section.eyebrow)}</span>` : '') +
    `<span class="section-head__count">${pluralize(section.games.length, 'game')}</span></header>`
  );
}

export function renderNav(nav, facets, active) {
  const item = (entry, variant) => {
    const count = facets.views[entry.view] ?? 0;
    const live = facets.live[entry.view] ?? 0;
    const current = entry.view === active;
    const classes = ['nav-item', `nav-item--${variant}`, current && 'is-active', !count && 'is-empty']
      .filter(Boolean)
      .join(' ');
    const label =
      entry.fullLabel && entry.fullLabel !== entry.label
        ? `<span class="nav-item__label"><span class="label-short">${esc(entry.label)}</span>` +
          `<span class="label-full">${esc(entry.fullLabel)}</span></span>`
        : `<span class="nav-item__label">${esc(entry.label)}</span>`;
    return (
      `<button type="button" class="${classes}" data-action="view" data-view="${esc(entry.view)}"` +
      `${current ? ' aria-current="page"' : ''}>` +
      (entry.icon ? ICONS[entry.icon] : '') +
      label +
      (live ? `<span class="live-dot" title="${pluralize(live, 'game')} live now"></span>` : '') +
      `<span class="nav-item__count" title="${pluralize(count, 'game')}">${count}</span></button>`
    );
  };
  const top = nav.items.map((entry) => item(entry, 'top')).join('');
  const divisions = nav.division
    ? `<div class="division-toggle" role="group" aria-label="Division">` +
      [
        ['fbs', 'FBS', 'Football Bowl Subdivision'],
        ['fcs', 'FCS', 'Football Championship Subdivision'],
      ]
        .map(
          ([value, label, title]) =>
            `<button type="button" class="division-toggle__btn${nav.division === value ? ' is-active' : ''}" ` +
            `data-action="division" data-division="${value}" aria-pressed="${nav.division === value}" title="${title}">${label}</button>`,
        )
        .join('') +
      `</div>`
    : '';
  const groups = nav.groups
    .map((group) => {
      const head = group.view ? item(group, 'group') : `<div class="nav-group__label">${esc(group.label)}</div>`;
      const children = group.children.map((child) => item(child, 'child')).join('');
      return `<div class="nav-group">${head}${children ? `<div class="nav-group__items">${children}</div>` : ''}</div>`;
    })
    .join('');
  return `${divisions}<div class="nav-top">${top}</div>${groups}`;
}

const STATUS_LABELS = { all: 'All', live: 'Live', upcoming: 'Upcoming', final: 'Final' };

export function renderStatusTabs(counts, active) {
  return STATUS_FILTERS.map((status) => {
    const current = status === active;
    const live = status === 'live' && counts.live > 0;
    return (
      `<button type="button" class="seg${current ? ' is-active' : ''}${live ? ' has-live' : ''}" ` +
      `data-action="status" data-status="${status}" aria-pressed="${current}">` +
      `<span class="seg__label">${live ? LIVE_DOT : ''}${STATUS_LABELS[status]}</span>` +
      `<span class="seg__count">${counts[status] ?? 0}</span></button>`
    );
  }).join('');
}

export function renderSelectOptions(options, selected) {
  return options
    .map(
      (option) =>
        `<option value="${esc(option.value)}"${option.value === selected ? ' selected' : ''}>${esc(option.label)}</option>`,
    )
    .join('');
}

export function renderWeekOptions(calendar, selectedKey, currentKey, { compact = false } = {}) {
  let html = '';
  let group = null;
  for (const week of calendar) {
    if (week.group !== group) {
      if (group !== null) html += '</optgroup>';
      group = week.group;
      html += `<optgroup label="${esc(group || 'Season')}">`;
    }
    const key = `${week.year}-${week.seasonType}-${week.week}`;
    const detail = week.detail ? ` · ${compactRange(week.detail)}` : '';
    const current = key === currentKey && !compact ? ' · this week' : '';
    html += `<option value="${esc(key)}"${key === selectedKey ? ' selected' : ''}>${esc(week.label + detail + current)}</option>`;
  }
  if (group !== null) html += '</optgroup>';
  return html;
}

/** One-line result for a team's game this week, used by the rankings panel. */
export function teamResult(teamId, game, ctx) {
  if (!game) return { text: 'Bye', tone: 'muted', opponent: 'No game this week' };
  const home = game.home.id === teamId;
  const us = home ? game.home : game.away;
  const them = home ? game.away : game.home;
  const opponent = `${home || game.neutralSite ? 'vs' : '@'} ${them.rank ? `#${them.rank} ` : ''}${them.name}`;
  if (game.canceled) return { text: 'Canceled', tone: 'muted', opponent };
  if (game.postponed) return { text: 'Postponed', tone: 'muted', opponent };
  const ours = us.score ?? 0;
  const theirs = them.score ?? 0;
  if (game.state === 'in') return { text: `${ours}–${theirs}`, tone: 'live', opponent };
  if (game.state === 'post') {
    if (us.winner || (!them.winner && ours > theirs)) return { text: `W ${ours}–${theirs}`, tone: 'win', opponent };
    if (them.winner || ours < theirs) return { text: `L ${ours}–${theirs}`, tone: 'loss', opponent };
    return { text: `T ${ours}–${theirs}`, tone: 'muted', opponent };
  }
  const when = game.timeValid
    ? formatWeekdayTime(game.date, ctx.timeZone)
    : `${formatWeekday(game.date, ESPN_TIME_ZONE)} TBD`;
  return { text: when, tone: 'upcoming', opponent };
}

function renderPollRow(entry, game, ctx) {
  const moved = entry.previous ? entry.previous - entry.rank : 0;
  const trend =
    moved > 0
      ? `<span class="trend trend--up" title="Up ${moved}">▲${moved}</span>`
      : moved < 0
        ? `<span class="trend trend--down" title="Down ${-moved}">▼${-moved}</span>`
        : '';
  const result = teamResult(entry.team.id, game, ctx);
  const meta = [entry.record, result.opponent].filter(Boolean).join(' · ');
  const inner =
    `<span class="poll-row__rank">${entry.rank}</span>` +
    renderLogo(entry.team, 24, 'poll-row__logo') +
    `<span class="poll-row__body"><span class="poll-row__name"><span class="poll-row__team">${esc(entry.team.name)}</span>${trend}</span>` +
    `<span class="poll-row__meta">${esc(meta)}</span></span>` +
    `<span class="poll-row__result result--${result.tone}">${result.tone === 'live' ? LIVE_DOT : ''}${esc(result.text)}</span>`;
  return game
    ? `<li><button type="button" class="poll-row" data-action="open-game" data-id="${esc(game.id)}">${inner}</button></li>`
    : `<li><div class="poll-row poll-row--static">${inner}</div></li>`;
}

export function renderRankings({ polls, pollId, gamesByTeam, ctx, loading = false, error = null }) {
  if (!polls.length) {
    if (!loading && !error) return '';
    const body = loading
      ? `<div class="poll__loading">${'<div class="sk sk--row"></div>'.repeat(8)}</div>`
      : '<p class="panel__empty">Rankings are unavailable right now.</p>';
    return `<section class="panel poll"><header class="panel__head"><h2 class="panel__title">Top 25</h2></header>${body}</section>`;
  }
  const poll = polls.find((p) => p.id === pollId) || polls[0];
  const picker =
    polls.length > 1
      ? `<label class="sr-only" for="poll-select">Choose a poll</label>` +
        `<select id="poll-select" class="select select--small" data-control="poll">` +
        renderSelectOptions(polls.map((p) => ({ value: p.id, label: p.shortName })), poll.id) +
        `</select>`
      : '';
  return (
    `<section class="panel poll" aria-labelledby="poll-title">` +
    `<header class="panel__head"><div><h2 class="panel__title" id="poll-title">${esc(poll.name)}</h2>` +
    (poll.label ? `<p class="panel__sub">${esc(poll.label)}</p>` : '') +
    `</div>${picker}</header>` +
    `<ol class="poll__list">${poll.ranks
      .slice(0, 25)
      .map((entry) => renderPollRow(entry, gamesByTeam.get(entry.team.id), ctx))
      .join('')}</ol></section>`
  );
}

function renderLinescore(game) {
  const periods = Math.max(game.away.linescores.length, game.home.linescores.length);
  if (!periods || game.state === 'pre') return '';
  const heads = Array.from({ length: periods }, (_, i) => periodLabel(i + 1).replace(/^Q/, ''));
  const row = (team) =>
    `<tr><th scope="row">${renderLogo(team, 20)}<span>${esc(team.abbr || team.name)}</span></th>` +
    heads.map((_, i) => `<td>${team.linescores[i] ?? '–'}</td>`).join('') +
    `<td class="linescore__total">${team.score ?? 0}</td></tr>`;
  return (
    `<div class="detail__block"><table class="linescore"><caption class="sr-only">Scoring by quarter</caption>` +
    `<thead><tr><th scope="col"><span class="sr-only">Team</span></th>` +
    heads.map((h) => `<th scope="col">${esc(h)}</th>`).join('') +
    `<th scope="col">T</th></tr></thead><tbody>${row(game.away)}${row(game.home)}</tbody></table></div>`
  );
}

function renderSituation(game) {
  const situation = game.situation;
  if (game.state !== 'in' || !situation) return '';
  const holder = [game.away, game.home].find((team) => team.id === situation.possession);
  const lines = [];
  const down = situation.downDistance || situation.shortDownDistance;
  if (down || holder) {
    lines.push(
      `<p class="situation__down">${holder ? `<span class="possession">${ICONS.ball}</span>${esc(holder.name)} ball` : ''}` +
        `${holder && down ? ' · ' : ''}${esc(down || '')}` +
        `${situation.isRedZone ? ' <span class="chip chip--redzone">Red zone</span>' : ''}</p>`,
    );
  }
  if (situation.lastPlay) lines.push(`<p class="situation__play"><span>Last play</span> ${esc(situation.lastPlay)}</p>`);
  const odds = situation.winProbability;
  if (odds) {
    const away = Math.round(odds.away * 100);
    const home = 100 - away;
    lines.push(
      `<div class="winprob" style="--away:${stripeColor(game.away)};--home:${stripeColor(game.home)}">` +
        `<div class="winprob__labels"><span>${esc(game.away.abbr || game.away.name)} ${away}%</span>` +
        `<span>Win probability</span><span>${home}% ${esc(game.home.abbr || game.home.name)}</span></div>` +
        `<div class="winprob__bar" role="img" aria-label="Win probability: ${esc(game.away.name)} ${away}%, ${esc(game.home.name)} ${home}%">` +
        `<span style="width:${away}%"></span><span style="width:${home}%"></span></div></div>`,
    );
  }
  return lines.length ? `<div class="detail__block situation">${lines.join('')}</div>` : '';
}

function renderInfo(game, ctx) {
  const rows = [['Kickoff', formatKickoff(game, ctx.timeZone)]];
  if (game.broadcasts.length) rows.push(['TV', game.broadcasts.join(', ')]);
  if (game.venue) {
    const place = [game.venue.name, venueLine(game.venue)].filter(Boolean).join(' · ');
    rows.push(['Venue', `${place}${game.neutralSite ? ' (neutral site)' : ''}`]);
  }
  if (game.odds) {
    rows.push(['Line', [game.odds.details, game.odds.overUnder !== null ? `O/U ${game.odds.overUnder}` : ''].filter(Boolean).join(' · ')]);
  }
  if (game.league === 'college' && game.conferenceGame) {
    const name = ctx.conference(game.home.conferenceId || game.away.conferenceId)?.name;
    rows.push(['Type', `${name || 'Conference'} game`]);
  }
  if (game.league === 'nfl' && game.divisionGame) rows.push(['Type', 'Division game']);
  if (game.attendance && game.state === 'post') rows.push(['Attendance', game.attendance.toLocaleString('en-US')]);
  return (
    `<dl class="detail__info">` +
    rows.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join('') +
    `</dl>`
  );
}

function renderLeaders(game) {
  if (game.state === 'pre' || !game.leaders.length) return '';
  const teams = new Map([game.away, game.home].map((team) => [team.id, team]));
  return (
    `<div class="detail__block"><h3 class="detail__heading">Game leaders</h3><ul class="leaders">` +
    game.leaders
      .slice(0, 6)
      .map((leader) => {
        const team = teams.get(leader.teamId);
        return (
          `<li><span class="leaders__cat">${esc(leader.category)}</span>` +
          `<span class="leaders__who">${esc(leader.athlete)}${leader.position ? ` <small>${esc(leader.position)}</small>` : ''}` +
          `${team ? ` <small>${esc(team.abbr || team.name)}</small>` : ''}</span>` +
          `<span class="leaders__stat">${esc(leader.value)}</span></li>`
        );
      })
      .join('') +
    `</ul></div>`
  );
}

function followButton(game, team, ctx) {
  const on = ctx.isTeamFollowed(game.league, team.id);
  const label = on ? `Stop following ${team.name}` : `Follow ${team.name}: its games will always appear in Favorites`;
  return (
    `<button type="button" class="follow-pill${on ? ' is-active' : ''}" data-action="toggle-follow" ` +
    `data-game-id="${esc(game.id)}" data-team-id="${esc(team.id)}" aria-pressed="${on}" ` +
    `aria-label="${esc(on ? `Following ${team.name}` : `Follow ${team.name}`)}" title="${esc(label)}">` +
    `${ICONS.heart}<span>${on ? 'Following' : 'Follow'}</span></button>`
  );
}

function detailTeam(game, team, ctx) {
  const result = outcome(game, team);
  const conference = team.confRecord && ctx.conference ? ctx.conference(team.conferenceId)?.name : null;
  const record = [team.record, team.confRecord ? `${team.confRecord} ${conference || 'conf'}` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    `<div class="matchup__team${result === 'lost' ? ' is-loser' : ''}">` +
    renderLogo(team, 56, 'matchup__logo') +
    `<div class="matchup__name">${team.rank ? `<span class="rank">${team.rank}</span>` : ''}${esc(team.name)}</div>` +
    `<div class="matchup__mascot">${esc(team.mascot || team.displayName)}</div>` +
    (record ? `<div class="matchup__record">${esc(record)}</div>` : '') +
    followButton(game, team, ctx) +
    `</div>`
  );
}

export function renderGameDetail(game, ctx) {
  const status = gameStatus(game, { showDay: true, timeZone: ctx.timeZone });
  const favorite = ctx.isGameFavorite(game.id);
  const scoreClass = (team) => `matchup__pts${outcome(game, team) === 'lost' ? ' is-loser' : ''}`;
  const middle =
    game.state === 'pre'
      ? `<div class="matchup__vs">${game.neutralSite ? 'vs' : '@'}</div>`
      : `<div class="matchup__scores"><span class="${scoreClass(game.away)}">${game.away.score ?? 0}</span>` +
        `<span class="matchup__dash">–</span><span class="${scoreClass(game.home)}">${game.home.score ?? 0}</span></div>`;
  return (
    `<div class="detail" style="--away:${stripeColor(game.away)};--home:${stripeColor(game.home)}">` +
    `<div class="detail__bar"><span class="detail__title">${esc(game.shortName)}</span>` +
    `<button type="button" class="icon-btn icon-btn--plain" data-action="close-dialog" aria-label="Close details">${ICONS.close}</button></div>` +
    `<h2 class="sr-only" id="dialog-title">${esc(game.name)}</h2>` +
    (game.note ? `<p class="detail__note">${esc(game.note)}</p>` : '') +
    `<div class="matchup">${detailTeam(game, game.away, ctx)}<div class="matchup__middle">${middle}` +
    `<div class="matchup__status status--${status.tone}">${esc(game.state === 'pre' ? formatShortDate(game.date, ctx.timeZone) : status.text)}</div></div>` +
    `${detailTeam(game, game.home, ctx)}</div>` +
    renderSituation(game) +
    renderLinescore(game) +
    `<div class="detail__block">${renderInfo(game, ctx)}</div>` +
    renderLeaders(game) +
    `<div class="detail__actions">` +
    `<button type="button" class="btn btn--favorite${favorite ? ' is-active' : ''}" data-action="toggle-favorite" ` +
    `data-id="${esc(game.id)}" aria-pressed="${favorite}">${ICONS.star}<span>${favorite ? 'Saved to favorites' : 'Favorite this matchup'}</span></button>` +
    (game.link
      ? `<a class="btn btn--ghost" href="${esc(game.link)}" target="_blank" rel="noopener noreferrer">` +
        `<span>Full game on ESPN</span>${ICONS.external}</a>`
      : '') +
    `</div></div>`
  );
}

export function renderFavoritesPanel({ teams, saved, ctx }) {
  const chips = teams
    .map(
      (team) =>
        `<span class="follow-chip">${renderLogo(team, 20)}<span>${esc(team.name)}</span>` +
        `<button type="button" class="follow-chip__remove" data-action="unfollow" data-team-id="${esc(team.id)}" ` +
        `aria-label="Stop following ${esc(team.name)}" title="Stop following">${ICONS.close}</button></span>`,
    )
    .join('');
  const list = saved
    .map((game) => {
      const when = `${formatShortDate(game.date, ctx.timeZone)} · ${game.timeValid ? formatTime(game.date, ctx.timeZone) : 'TBD'}`;
      return (
        `<li><button type="button" class="saved-game" data-action="goto-favorite" data-id="${esc(game.id)}">` +
        renderLogo(game.away, 22) +
        renderLogo(game.home, 22) +
        `<span class="saved-game__name">${esc(game.away.name)} @ ${esc(game.home.name)}</span>` +
        `<span class="saved-game__when">${esc(when)}</span>${ICONS.chevronRight}</button></li>`
      );
    })
    .join('');
  return (
    `<section class="panel favorites-panel" aria-label="Your favorites">` +
    `<div class="favorites-panel__block"><h2 class="favorites-panel__title">${ICONS.heart}Teams you follow</h2>` +
    (chips
      ? `<div class="follow-chips">${chips}</div>`
      : `<p class="favorites-panel__hint">Open any game and tap <strong>Follow</strong> — every game that team plays will show up here automatically.</p>`) +
    `</div>` +
    (list
      ? `<div class="favorites-panel__block"><h2 class="favorites-panel__title">${ICONS.calendar}Saved matchups in other weeks</h2>` +
        `<ul class="saved-list">${list}</ul></div>`
      : '') +
    `</section>`
  );
}

export function renderEmpty({ icon = 'search', title, body = '', actions = [] }) {
  const buttons = actions
    .map(
      (action) =>
        `<button type="button" class="btn${action.primary ? ' btn--primary' : ''}" data-action="${esc(action.action)}">` +
        `${esc(action.label)}</button>`,
    )
    .join('');
  return (
    `<div class="empty">${ICONS[icon] || ''}<h2 class="empty__title">${esc(title)}</h2>` +
    (body ? `<p class="empty__body">${esc(body)}</p>` : '') +
    (buttons ? `<div class="empty__actions">${buttons}</div>` : '') +
    `</div>`
  );
}

export function renderSkeleton(count = 6) {
  const row = '<div class="sk-row"><span class="sk sk--logo"></span><span class="sk sk--text"></span><span class="sk sk--score"></span></div>';
  const card = `<div class="game game--skeleton"><span class="sk sk--line"></span>${row}${row}</div>`;
  return (
    `<section class="games-section" aria-busy="true" aria-label="Loading games">` +
    `<div class="section-head"><span class="sk sk--title"></span></div>` +
    `<div class="card-grid">${card.repeat(count)}</div></section>`
  );
}

export function renderByes(byes) {
  if (!byes.length) return '';
  return (
    `<div class="byes"><span class="byes__label">On bye</span>` +
    byes.map((team) => `<span class="bye">${renderLogo(team, 20)}<span>${esc(team.abbr || team.name)}</span></span>`).join('') +
    `</div>`
  );
}

export function renderBanner({ tone = 'error', message, action = null }) {
  return (
    `<div class="banner banner--${esc(tone)}" role="status"><span>${esc(message)}</span>` +
    (action ? `<button type="button" class="btn btn--small" data-action="${esc(action.action)}">${esc(action.label)}</button>` : '') +
    `</div>`
  );
}
