const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/**
 * ISO-8601 week (Monday start) of the local calendar date.
 * @param {number} ts
 * @returns {{ year: number, week: number }}
 */
export function isoWeek(ts) {
  const d = new Date(ts);
  // Work in UTC on the local calendar date to avoid DST effects.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7; // Mon=1 .. Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum); // Thursday of this week
  const year = t.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return { year, week };
}

/**
 * @param {number} ts
 * @returns {string}
 */
export function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * @param {number} ts
 * @returns {string}
 */
export function formatTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
