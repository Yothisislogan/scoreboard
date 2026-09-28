// Date, time and game-status labels. All functions take an optional IANA
// time zone; leaving it undefined uses the viewer's own zone.

export const ESPN_TIME_ZONE = 'America/New_York';

const formatters = new Map();

function formatter(options) {
  const key = JSON.stringify(options);
  let instance = formatters.get(key);
  if (!instance) {
    instance = new Intl.DateTimeFormat('en-US', options);
    formatters.set(key, instance);
  }
  return instance;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar day ("2026-09-26") of a moment, as seen in the given time zone. */
export function dayKey(value, timeZone) {
  const date = toDate(value);
  if (!date) return 'unknown';
  const parts = formatter({ timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Games without a confirmed kickoff carry a placeholder time. Read their day
 * in ESPN's home zone so they don't slide onto the previous evening out west.
 */
export function gameDayKey(game, timeZone) {
  return dayKey(game.date, game.timeValid ? timeZone : ESPN_TIME_ZONE);
}

function keyToNoonUTC(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function formatDayTitle(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'Date to be announced';
  return formatter({ timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(keyToNoonUTC(key));
}

export function relativeDayLabel(key, now, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const diff = Math.round((keyToNoonUTC(key) - keyToNoonUTC(dayKey(now, timeZone))) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return '';
}

export function formatTime(value, timeZone) {
  const date = toDate(value);
  return date ? formatter({ timeZone, hour: 'numeric', minute: '2-digit' }).format(date) : '';
}

export function formatWeekday(value, timeZone) {
  const date = toDate(value);
  return date ? formatter({ timeZone, weekday: 'short' }).format(date) : '';
}

export function formatWeekdayTime(value, timeZone) {
  const date = toDate(value);
  return date ? `${formatWeekday(date, timeZone)} ${formatTime(date, timeZone)}` : '';
}

export function formatShortDate(value, timeZone) {
  const date = toDate(value);
  return date ? formatter({ timeZone, month: 'short', day: 'numeric' }).format(date) : '';
}

/** "Saturday, September 26 · 3:30 PM EDT", or "· Time TBD" for unscheduled kickoffs. */
export function formatKickoff(game, timeZone) {
  const date = toDate(game.date);
  if (!date) return 'Date TBD';
  const zone = game.timeValid ? timeZone : ESPN_TIME_ZONE;
  const day = formatter({ timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  if (!game.timeValid) return `${day} · Time TBD`;
  const time = formatter({ timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
  return `${day} · ${time}`;
}

/** "Sep 22-Sep 28" -> "Sep 22–28"; other ranges just get an en dash. */
export function compactRange(detail) {
  const text = String(detail || '').trim();
  const sameMonth = /^([A-Za-z]{3,9})\.? (\d{1,2})\s*-\s*\1\.? (\d{1,2})$/.exec(text);
  if (sameMonth) return `${sameMonth[1]} ${sameMonth[2]}–${sameMonth[3]}`;
  return text.replace(/\s*-\s*/, '–');
}

export function periodLabel(period) {
  if (!period || period < 1) return '';
  if (period <= 4) return `Q${period}`;
  const overtime = period - 4;
  return overtime === 1 ? 'OT' : `${overtime}OT`;
}

/**
 * Short status line for a game card.
 * tone is one of: live, upcoming, final, muted.
 */
export function gameStatus(game, { showDay = false, timeZone } = {}) {
  if (game.canceled) return { text: 'Canceled', tone: 'muted' };
  if (game.postponed) return { text: 'Postponed', tone: 'muted' };
  if (game.state === 'in') {
    const period = periodLabel(game.period);
    if (/HALFTIME/.test(game.statusName)) return { text: 'Halftime', tone: 'live' };
    if (/END_PERIOD/.test(game.statusName)) return { text: `End of ${period || 'quarter'}`, tone: 'live' };
    if (game.suspended) return { text: 'Suspended', tone: 'live' };
    if (game.delayed) return { text: 'Delayed', tone: 'live' };
    if (period && game.clock) return { text: `${period} · ${game.clock}`, tone: 'live' };
    return { text: game.statusShort || 'In progress', tone: 'live' };
  }
  if (game.state === 'post') {
    return { text: /final/i.test(game.statusShort) ? game.statusShort : 'Final', tone: 'final' };
  }
  if (!game.timeValid) {
    return { text: showDay ? `${formatWeekday(game.date, ESPN_TIME_ZONE)} · TBD` : 'Time TBD', tone: 'upcoming' };
  }
  return {
    text: showDay ? formatWeekdayTime(game.date, timeZone) : formatTime(game.date, timeZone),
    tone: 'upcoming',
  };
}

export function timeAgo(timestamp, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
