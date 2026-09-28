// ESPN's public site API. It needs no key and allows cross-origin requests,
// so the browser calls it directly. When that fails (a network filter, or no
// CORS), requests retry through the /espn/ proxy that server.js provides.

import { FBS_GROUP_ID, FCS_GROUP_ID } from './conferences.js';

export const ESPN_ORIGIN = 'https://site.api.espn.com';

const SPORT_PATH = {
  nfl: 'football/nfl',
  college: 'football/college-football',
};

export class HttpError extends Error {
  constructor(status, url) {
    super(`ESPN responded with ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

export function scoreboardPath(league, { division = 'fbs', week = null } = {}) {
  const sport = SPORT_PATH[league];
  if (!sport) throw new Error(`Unknown league: ${league}`);
  const params = new URLSearchParams();
  if (league === 'college') {
    params.set('groups', division === 'fcs' ? FCS_GROUP_ID : FBS_GROUP_ID);
    params.set('limit', '400');
  }
  if (week) {
    params.set('dates', String(week.year));
    params.set('seasontype', String(week.seasonType));
    params.set('week', String(week.week));
  }
  const query = params.toString();
  return `/apis/site/v2/sports/${sport}/scoreboard${query ? `?${query}` : ''}`;
}

export function rankingsPath() {
  return `/apis/site/v2/sports/${SPORT_PATH.college}/rankings`;
}

export function conferenceDirectoryPath(groupId, year) {
  const season = year ? `&season=${encodeURIComponent(year)}` : '';
  return `/apis/v2/sports/${SPORT_PATH.college}/standings?group=${encodeURIComponent(groupId)}${season}`;
}

let proxyPreferred = false;

function proxyUrl(path) {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  return new URL(`espn${path}`, location.href).href;
}

async function fetchJson(url, { signal, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new HttpError(response.status, url);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** GET an ESPN API path, trying the direct URL first and the local proxy second. */
export async function espnGet(path, { signal, timeoutMs = 12000, fetchImpl = globalThis.fetch } = {}) {
  const direct = ESPN_ORIGIN + path;
  const proxied = proxyUrl(path);
  const attempts = proxied ? (proxyPreferred ? [proxied, direct] : [direct, proxied]) : [direct];
  let lastError;
  for (const url of attempts) {
    if (signal?.aborted) break;
    try {
      const json = await fetchJson(url, { signal, timeoutMs, fetchImpl });
      proxyPreferred = url === proxied;
      return json;
    } catch (error) {
      lastError = error;
      // ESPN answered with a client error: the proxy would get the same answer.
      if (error instanceof HttpError && error.status < 500 && url === direct) break;
    }
  }
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw lastError;
}

export function fetchScoreboard(league, options = {}) {
  return espnGet(scoreboardPath(league, options), options);
}

export function fetchRankings(options = {}) {
  return espnGet(rankingsPath(), options);
}

export function fetchConferenceDirectory(groupId, year, options = {}) {
  return espnGet(conferenceDirectoryPath(groupId, year), options);
}
