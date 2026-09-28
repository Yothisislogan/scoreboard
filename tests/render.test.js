import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeFacets } from '../assets/js/filters.js';
import {
  esc,
  logoSrc,
  renderCard,
  renderGameDetail,
  renderLogo,
  renderLogoBadge,
  renderNav,
  renderRankings,
  renderStatusTabs,
  renderWeekOptions,
  teamResult,
} from '../assets/js/render.js';
import { indexGamesByTeam } from '../assets/js/filters.js';
import { normalizeRankings } from '../assets/js/normalize.js';
import { defaultPrefs } from '../assets/js/state.js';
import { buildNav, navViews } from '../assets/js/views.js';
import { collegeGames, fixture, makeContext } from './helpers.js';

const game = (id) => collegeGames().find((g) => g.id === id);

test('esc neutralizes markup', () => {
  assert.equal(esc(`<img src=x onerror="alert('1')">&`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;');
  assert.equal(esc(null), '');
});

test('cards escape data from the feed', () => {
  const hostile = structuredClone(game('401800019'));
  hostile.away.name = '<script>alert(1)</script>';
  hostile.shortName = '"><b>x</b>';
  const html = renderCard(hostile, makeContext('college'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('"><b>'));
});

test('live card shows status, ranks, scores, possession and red zone', () => {
  const html = renderCard(game('401800012'), makeContext('college'));
  assert.match(html, /class="game game--in"/);
  assert.match(html, /Q2 · 2:14/);
  assert.match(html, /<span class="rank">3<\/span><span class="team__label">Georgia<\/span>/);
  assert.match(html, /team__score">14</);
  assert.match(html, /title="Georgia has the ball"/);
  assert.match(html, /Red zone/);
  assert.match(html, /aria-pressed="false"/);
});

test('final card marks the winner and dims the loser', () => {
  const html = renderCard(game('401800005'), makeContext('college'));
  assert.match(html, /<div class="team is-loser">.*Purdue/s);
  assert.match(html, /<div class="team is-winner">.*Ohio State/s);
});

test('favorites and followed teams are reflected on cards', () => {
  const ctx = makeContext('college', { games: new Set(['401800019']), teams: new Set(['college:251']) });
  const html = renderCard(game('401800019'), ctx, { showDay: true });
  assert.match(html, /is-favorite/);
  assert.match(html, /is-followed/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /You follow Texas/);
  assert.match(html, /Sat 7:30 PM/);
  assert.match(html, /TEX -7\.5/);
});

test('postponed game shows no score', () => {
  const html = renderCard(game('401800030'), makeContext('college'));
  assert.match(html, /Postponed/);
  assert.match(html, /game--off/);
  assert.doesNotMatch(html, /team__score">0</);
});

test('logos are resized through ESPN and fall back to team-colored badges', () => {
  assert.equal(
    logoSrc('https://a.espncdn.com/i/teamlogos/ncaa/500/333.png', 56),
    'https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/333.png&w=56&h=56',
  );
  assert.equal(logoSrc('https://example.com/logo.png', 56), 'https://example.com/logo.png');
  const img = renderLogo({ abbr: 'ALA', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/333.png', color: '#9e1632' });
  assert.match(img, /^<img class="logo"/);
  assert.match(img, /data-abbr="ALA"/);
  const badge = renderLogo({ abbr: 'ALA', color: '#9e1632' });
  assert.match(badge, /logo--badge/);
  assert.match(badge, /--logo-bg:#9e1632/);
  assert.match(badge, /--logo-fg:#ffffff/);
  assert.match(renderLogoBadge('MIZ', '#f1b82d', 28), /--logo-fg:#0f172a/, 'dark text on light colors');
  assert.match(renderLogoBadge('X', 'red;background:url(evil)', 28), /--logo-bg:#64748b/, 'unsafe colors are replaced');
});

test('nav shows counts, live markers, the active view and the division toggle', () => {
  const games = collegeGames();
  const ctx = makeContext('college');
  const nav = buildNav('college');
  const facets = computeFacets(games, defaultPrefs('college'), ctx, navViews(nav));
  const html = renderNav(nav, facets, 'sec');
  assert.match(html, /data-view="sec" aria-current="page"/);
  assert.match(html, /data-division="fbs" aria-pressed="true"/);
  assert.match(html, /data-division="fcs" aria-pressed="false"/);
  assert.match(html, /Top 25<\/span><span class="live-dot"[^>]*><\/span><span class="nav-item__count"[^>]*>19</);
  assert.match(html, /Conference USA<\/span><span class="nav-item__count"[^>]*>1</);

  const nfl = renderNav(buildNav('nfl'), { views: {}, live: {} }, 'afc-east');
  assert.match(nfl, /<span class="label-short">East<\/span><span class="label-full">AFC East<\/span>/);
  assert.doesNotMatch(nfl, /division-toggle/);
});

test('status tabs', () => {
  const html = renderStatusTabs({ all: 30, live: 7, upcoming: 11, final: 12 }, 'live');
  assert.match(html, /data-status="live" aria-pressed="true"/);
  assert.match(html, /has-live/);
  assert.match(html, /Upcoming<\/span><span class="seg__count">11</);
});

test('week menu groups by season part and marks this week', () => {
  const calendar = [
    { year: 2026, seasonType: 2, week: 1, label: 'Week 1', detail: 'Aug 29-Sep 7', group: 'Regular Season' },
    { year: 2026, seasonType: 2, week: 2, label: 'Week 2', detail: 'Sep 8-Sep 14', group: 'Regular Season' },
    { year: 2026, seasonType: 3, week: 1, label: 'Bowls', detail: 'Dec 15-Jan 20', group: 'Postseason' },
  ];
  const html = renderWeekOptions(calendar, '2026-2-2', '2026-2-2');
  assert.equal((html.match(/<optgroup/g) || []).length, 2);
  assert.match(html, /<option value="2026-2-2" selected>Week 2 · Sep 8–14 · this week<\/option>/);
  assert.match(html, /Bowls · Dec 15–Jan 20/);
});

test('rankings panel pairs each ranked team with its game this week', () => {
  const games = collegeGames();
  const { polls } = normalizeRankings(fixture('college-rankings.json'));
  const html = renderRankings({ polls, pollId: '1', gamesByTeam: indexGamesByTeam(games), ctx: makeContext('college') });
  assert.match(html, /AP Top 25/);
  assert.equal((html.match(/<li>/g) || []).length, 25);
  assert.match(html, /Tennessee.*Bye/s);
  assert.match(html, /<option value="2">Coaches Poll<\/option>/);

  const ctx = makeContext('college');
  const index = indexGamesByTeam(games);
  assert.deepEqual(teamResult('194', index.get('194'), ctx), { text: 'W 45–7', tone: 'win', opponent: 'vs Purdue' });
  assert.deepEqual(teamResult('2509', index.get('2509'), ctx), { text: 'L 7–45', tone: 'loss', opponent: '@ #2 Ohio State' });
  assert.deepEqual(teamResult('61', index.get('61'), ctx), { text: '14–17', tone: 'live', opponent: '@ #10 Alabama' });
  assert.deepEqual(teamResult('251', index.get('251'), ctx), { text: 'Sat 7:30 PM', tone: 'upcoming', opponent: 'vs #11 Ole Miss' });
  assert.deepEqual(teamResult('245', index.get('245'), ctx).opponent, 'vs Arkansas', 'neutral sites read "vs"');
  assert.equal(teamResult('2633', undefined, ctx).text, 'Bye');

  assert.equal(renderRankings({ polls: [], gamesByTeam: new Map(), ctx }), '');
  assert.match(renderRankings({ polls: [], gamesByTeam: new Map(), ctx, error: new Error('x') }), /unavailable/);
});

test('game detail includes the linescore, situation, info and actions', () => {
  const ctx = makeContext('college', { teams: new Set(['college:61']) });
  const html = renderGameDetail(game('401800012'), ctx);
  assert.match(html, /UGA @ ALA/);
  assert.match(html, /Georgia ball/);
  assert.match(html, /Win probability/);
  assert.match(html, /<th scope="col">1<\/th><th scope="col">2<\/th><th scope="col">T<\/th>/);
  assert.match(html, /Saturday, September 26 · 3:30 PM EDT/);
  assert.match(html, /SEC game/);
  assert.match(html, /1-0 SEC/);
  assert.match(html, /data-team-id="61" aria-pressed="true"/);
  assert.match(html, /data-team-id="333" aria-pressed="false"/);
  assert.match(html, /Favorite this matchup/);
  assert.match(html, /href="https:\/\/www\.espn\.com\/college-football\/game\/_\/gameId\/401800012/);
  assert.match(html, /Game leaders/);

  const upcoming = renderGameDetail(game('401800019'), ctx);
  assert.match(upcoming, /matchup__vs">@</);
  assert.doesNotMatch(upcoming, /linescore/);
  assert.doesNotMatch(upcoming, /Game leaders/);
  assert.match(upcoming, /TEX -7\.5 · O\/U 55\.5/);
});
