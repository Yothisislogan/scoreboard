import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultPollId,
  normalizeConferenceDirectory,
  normalizeRankings,
  normalizeScoreboard,
} from '../assets/js/normalize.js';
import { collegeGames, fixture, nflGames } from './helpers.js';

const byId = (games, id) => games.find((game) => game.id === id);

test('college: reads week, calendar and every game', () => {
  const data = normalizeScoreboard(fixture('college-scoreboard.json'), { league: 'college', division: 'fbs' });
  assert.equal(data.games.length, 30);
  assert.deepEqual(data.week, { year: 2026, seasonType: 2, week: 4 });
  assert.deepEqual(data.season, { year: 2026, type: 2 });
  // Regular season weeks plus the bowl entry; the off-season block is dropped.
  assert.equal(data.calendar.length, 16);
  assert.deepEqual(
    { ...data.calendar[3], startDate: undefined, endDate: undefined },
    {
      year: 2026,
      seasonType: 2,
      week: 4,
      label: 'Week 4',
      shortLabel: 'Week 4',
      detail: 'Sep 22-Sep 28',
      group: 'Regular Season',
      startDate: undefined,
      endDate: undefined,
    },
  );
  assert.equal(data.calendar.at(-1).label, 'Bowls');
  assert.equal(data.calendar.at(-1).seasonType, 3);
});

test('college: live game carries ranks, conference, situation and leaders', () => {
  const game = byId(collegeGames(), '401800012');
  assert.equal(game.state, 'in');
  assert.equal(game.shortName, 'UGA @ ALA');
  assert.equal(game.away.name, 'Georgia');
  assert.equal(game.away.displayName, 'Georgia Bulldogs');
  assert.equal(game.away.rank, 3);
  assert.equal(game.home.rank, 10);
  assert.equal(game.away.score, 14);
  assert.equal(game.home.score, 17);
  assert.deepEqual(game.away.linescores, [7, 7]);
  assert.equal(game.away.record, '3-0');
  assert.equal(game.away.confRecord, '1-0');
  assert.equal(game.home.conferenceId, '8');
  assert.equal(game.away.color, '#ba0c2f');
  assert.equal(game.conferenceGame, true);
  assert.equal(game.period, 2);
  assert.equal(game.clock, '2:14');
  assert.deepEqual(game.broadcasts, ['ABC']);
  assert.equal(game.situation.possession, '61');
  assert.equal(game.situation.downDistance, '2nd & 6 at ALA 14');
  assert.equal(game.situation.isRedZone, true);
  assert.deepEqual(game.situation.winProbability, { home: 0.46, away: 0.54 });
  assert.equal(game.leaders.length, 3);
  assert.deepEqual(game.leaders[0], {
    category: 'Passing',
    teamId: '61',
    athlete: 'G. Stockton',
    position: 'QB',
    value: '13/19, 176 YDS, 1 TD',
  });
  assert.match(game.link, /^https:\/\/www\.espn\.com\/college-football\/game\/_\/gameId\/401800012/);
  assert.deepEqual(game.week, { year: 2026, seasonType: 2, week: 4 });
});

test('college: unranked teams and scheduled games', () => {
  const games = collegeGames();
  const upcoming = byId(games, '401800019'); // Ole Miss at Texas
  assert.equal(upcoming.state, 'pre');
  assert.equal(upcoming.away.score, null);
  assert.equal(upcoming.home.score, null);
  assert.deepEqual(upcoming.odds, { details: 'TEX -7.5', overUnder: 55.5, provider: 'ESPN BET' });
  assert.equal(upcoming.situation, null);

  const unranked = byId(games, '401800009'); // Kent State at Toledo
  assert.equal(unranked.away.rank, null);
  assert.equal(unranked.home.rank, null);
});

test('college: special cases — postponed, TBD, neutral site, overtime', () => {
  const games = collegeGames();
  const postponed = byId(games, '401800030');
  assert.equal(postponed.postponed, true);
  assert.equal(postponed.away.score, null, 'postponed games show no score');

  const tbd = byId(games, '401800029');
  assert.equal(tbd.timeValid, false);

  const neutral = byId(games, '401800011');
  assert.equal(neutral.neutralSite, true);
  assert.equal(neutral.note, 'Southwest Classic');
  assert.equal(neutral.venue.city, 'Arlington');
  assert.equal(neutral.away.winner, true);

  const overtime = byId(games, '401800002');
  assert.equal(overtime.statusShort, 'Final/OT');
  assert.equal(overtime.away.linescores.length, 5);

  const nonConference = byId(games, '401800022'); // Stanford at Notre Dame
  assert.equal(nonConference.conferenceGame, false);
});

test('nfl: divisions, byes and division games', () => {
  const data = normalizeScoreboard(fixture('nfl-scoreboard.json'), { league: 'nfl' });
  assert.equal(data.games.length, 15);
  assert.deepEqual(
    data.byes.map((team) => team.abbr),
    ['LV', 'SF'],
  );
  const opener = byId(data.games, '401900001');
  assert.equal(opener.away.division, 'afc-east');
  assert.equal(opener.home.division, 'afc-east');
  assert.equal(opener.divisionGame, true);
  assert.equal(opener.away.name, 'Dolphins');
  assert.equal(opener.away.rank, null);
  assert.deepEqual(opener.broadcasts, ['Prime Video']);

  const crossover = byId(data.games, '401900007'); // Chargers at Giants
  assert.equal(crossover.away.division, 'afc-west');
  assert.equal(crossover.home.division, 'nfc-east');
  assert.equal(crossover.divisionGame, false);

  const redZone = byId(data.games, '401900012');
  assert.equal(redZone.situation.isRedZone, true);
  assert.equal(redZone.situation.possession, '7');

  const names = data.calendar.filter((week) => week.seasonType === 3).map((week) => week.label);
  assert.deepEqual(names, ['Wild Card Round', 'Divisional Round', 'Conference Championship', 'Pro Bowl', 'Super Bowl']);
});

test('nfl: every team maps to a division', () => {
  for (const game of nflGames()) {
    assert.ok(game.away.division, `${game.away.abbr} has a division`);
    assert.ok(game.home.division, `${game.home.abbr} has a division`);
  }
});

test('tolerates empty and malformed payloads', () => {
  for (const raw of [null, undefined, 'nope', {}, { events: null }, { leagues: [{}], events: [{}] }]) {
    const data = normalizeScoreboard(raw, { league: 'college' });
    assert.deepEqual(data.games, []);
    assert.deepEqual(data.calendar, []);
    assert.equal(data.week, null);
  }
  const sparse = normalizeScoreboard(
    {
      events: [
        {
          id: 7,
          competitions: [
            {
              competitors: [
                { homeAway: 'home', team: { id: 1, displayName: 'Home Team' }, score: { value: 21 } },
                { homeAway: 'away', team: { id: 2 } },
              ],
              status: { type: { state: 'post', completed: true, shortDetail: 'Final' } },
            },
          ],
        },
      ],
    },
    { league: 'college' },
  );
  const [game] = sparse.games;
  assert.equal(game.id, '7');
  assert.equal(game.home.name, 'Home Team');
  assert.equal(game.home.score, 21);
  assert.equal(game.away.name, 'TBD');
  assert.equal(game.away.score, null);
  assert.deepEqual(game.broadcasts, []);
  assert.match(game.link, /gameId\/7$/);
});

test('rankings: polls in order with movement and records', () => {
  const { polls } = normalizeRankings(fixture('college-rankings.json'));
  assert.deepEqual(
    polls.map((poll) => [poll.id, poll.type, poll.name, poll.label]),
    [
      ['1', 'ap', 'AP Top 25', 'Week 4'],
      ['2', 'usa', 'AFCA Coaches Poll', 'Week 4'],
    ],
  );
  const ap = polls[0];
  assert.equal(ap.ranks.length, 25);
  assert.deepEqual(ap.ranks[0].team, {
    id: '251',
    abbr: 'TEX',
    name: 'Texas',
    displayName: 'Texas Longhorns',
    logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png',
    color: '#bf5700',
  });
  assert.equal(ap.ranks[2].previous, 4);
  assert.equal(ap.ranks[23].previous, null, 'newly ranked teams have no previous rank');
  assert.equal(ap.ranks[0].record, '3-0');
  assert.equal(defaultPollId(polls), '1');
  assert.equal(defaultPollId([...polls, { id: '9', type: 'cfp', ranks: [] }]), '9');
  assert.deepEqual(normalizeRankings({}).polls, []);
});

test('conference directory: collects nested standings groups', () => {
  const names = normalizeConferenceDirectory(fixture('fcs-standings.json'));
  assert.deepEqual(names['20'], { name: 'Big Sky', fullName: 'Big Sky Conference' });
  assert.deepEqual(names['21'], { name: 'MVFC', fullName: 'Missouri Valley Football Conference' });
  assert.equal(names['48'].name, 'CAA');
  assert.equal(names['4801'].name, 'CAA North');
  assert.deepEqual(normalizeConferenceDirectory(null), {});
});
