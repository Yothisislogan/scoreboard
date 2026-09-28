import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compactRange,
  dayKey,
  formatDayTitle,
  formatKickoff,
  gameDayKey,
  gameStatus,
  periodLabel,
  pluralize,
  relativeDayLabel,
  timeAgo,
} from '../assets/js/format.js';
import { collegeGames } from './helpers.js';

const ET = 'America/New_York';
const game = (id) => collegeGames().find((g) => g.id === id);

test('status lines for every game state', () => {
  const status = (id, options) => gameStatus(game(id), { timeZone: ET, ...options });
  assert.deepEqual(status('401800012'), { text: 'Q2 · 2:14', tone: 'live' });
  assert.deepEqual(status('401800013'), { text: 'Halftime', tone: 'live' });
  assert.deepEqual(status('401800015'), { text: 'End of Q1', tone: 'live' });
  assert.deepEqual(status('401800005'), { text: 'Final', tone: 'final' });
  assert.deepEqual(status('401800002'), { text: 'Final/OT', tone: 'final' });
  assert.deepEqual(status('401800030'), { text: 'Postponed', tone: 'muted' });
  assert.deepEqual(status('401800019'), { text: '7:30 PM', tone: 'upcoming' });
  assert.deepEqual(status('401800019', { showDay: true }), { text: 'Sat 7:30 PM', tone: 'upcoming' });
  assert.deepEqual(status('401800029'), { text: 'Time TBD', tone: 'upcoming' });
  assert.deepEqual(status('401800029', { showDay: true }), { text: 'Sat · TBD', tone: 'upcoming' });
  assert.deepEqual(gameStatus({ ...game('401800019'), canceled: true }), { text: 'Canceled', tone: 'muted' });
});

test('times follow the viewer’s zone', () => {
  const texas = game('401800019');
  assert.equal(gameStatus(texas, { timeZone: 'America/Los_Angeles' }).text, '4:30 PM');
  assert.equal(formatKickoff(texas, ET), 'Saturday, September 26 · 7:30 PM EDT');
  assert.equal(formatKickoff(game('401800029'), 'America/Los_Angeles'), 'Saturday, September 26 · Time TBD');
});

test('period labels cover overtime', () => {
  assert.deepEqual([0, 1, 4, 5, 6, 8].map(periodLabel), ['', 'Q1', 'Q4', 'OT', '2OT', '4OT']);
});

test('day keys use the viewer’s zone, except for unscheduled kickoffs', () => {
  assert.equal(dayKey('2026-09-27T02:30Z', ET), '2026-09-26');
  assert.equal(dayKey('2026-09-27T02:30Z', 'UTC'), '2026-09-27');
  assert.equal(dayKey('not a date', ET), 'unknown');
  const tbd = game('401800029'); // placeholder time 07:00Z
  assert.equal(gameDayKey(tbd, 'Pacific/Honolulu'), '2026-09-26', 'TBD games stay on their ESPN day');
  assert.equal(gameDayKey({ ...tbd, timeValid: true }, 'Pacific/Honolulu'), '2026-09-25');
});

test('day titles and relative labels', () => {
  const now = Date.parse('2026-09-26T20:45:00Z');
  assert.equal(formatDayTitle('2026-09-26'), 'Saturday, September 26');
  assert.equal(formatDayTitle('unknown'), 'Date to be announced');
  assert.equal(relativeDayLabel('2026-09-26', now, ET), 'Today');
  assert.equal(relativeDayLabel('2026-09-27', now, ET), 'Tomorrow');
  assert.equal(relativeDayLabel('2026-09-25', now, ET), 'Yesterday');
  assert.equal(relativeDayLabel('2026-09-30', now, ET), '');
});

test('week ranges read compactly', () => {
  assert.equal(compactRange('Sep 22-Sep 28'), 'Sep 22–28');
  assert.equal(compactRange('Sep 3-9'), 'Sep 3–9');
  assert.equal(compactRange('Aug 29-Sep 7'), 'Aug 29–Sep 7');
  assert.equal(compactRange(''), '');
});

test('relative update times and plurals', () => {
  const now = 1_000_000;
  assert.equal(timeAgo(now - 3_000, now), 'just now');
  assert.equal(timeAgo(now - 42_000, now), '42s ago');
  assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago');
  assert.equal(timeAgo(now - 2 * 3_600_000, now), '2 hr ago');
  assert.equal(pluralize(1, 'game'), '1 game');
  assert.equal(pluralize(3, 'match', 'matches'), '3 matches');
});
