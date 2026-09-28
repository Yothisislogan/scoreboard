import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HttpError,
  conferenceDirectoryPath,
  espnGet,
  fetchScoreboard,
  rankingsPath,
  scoreboardPath,
} from '../assets/js/api.js';

test('scoreboard URLs', () => {
  assert.equal(scoreboardPath('nfl'), '/apis/site/v2/sports/football/nfl/scoreboard');
  assert.equal(
    scoreboardPath('nfl', { week: { year: 2026, seasonType: 3, week: 1 } }),
    '/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=3&week=1',
  );
  assert.equal(
    scoreboardPath('college'),
    '/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=400',
  );
  assert.equal(
    scoreboardPath('college', { division: 'fcs', week: { year: 2026, seasonType: 2, week: 5 } }),
    '/apis/site/v2/sports/football/college-football/scoreboard?groups=81&limit=400&dates=2026&seasontype=2&week=5',
  );
  assert.throws(() => scoreboardPath('mlb'));
  assert.equal(rankingsPath(), '/apis/site/v2/sports/football/college-football/rankings');
  assert.equal(
    conferenceDirectoryPath('81', 2026),
    '/apis/v2/sports/football/college-football/standings?group=81&season=2026',
  );
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('espnGet returns JSON from ESPN', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return jsonResponse({ events: [] });
  };
  const data = await fetchScoreboard('nfl', { fetchImpl });
  assert.deepEqual(data, { events: [] });
  assert.deepEqual(seen, ['https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard']);
});

test('espnGet surfaces HTTP errors', async () => {
  await assert.rejects(
    espnGet('/apis/site/v2/sports/football/nfl/scoreboard', { fetchImpl: async () => jsonResponse({}, 404) }),
    (error) => error instanceof HttpError && error.status === 404,
  );
});

test('espnGet times out slow requests', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  await assert.rejects(espnGet('/apis/x', { fetchImpl, timeoutMs: 20 }), { name: 'AbortError' });
});
