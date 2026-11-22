import { e1rm, formatWeight } from './metrics.js';

/**
 * @typedef {object} CsvRow
 * @property {number} completedAt
 * @property {string} gym
 * @property {string} exercise
 * @property {string} category
 * @property {string} machine
 * @property {number} setNo
 * @property {number} weight
 * @property {number} reps
 * @property {Unit} unit
 * @property {number | null} baseWeight
 * @property {Kind} [kind]
 * @property {boolean} [assisted]
 * @property {number | null} [bodyweight] The session's body weight, if one was noted.
 */

export const CSV_HEADER = 'date,time,gym,exercise,category,machine,set,weight,reps,unit,base_weight,e1rm,bodyweight';

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {string} value
 * @returns {string}
 */
function field(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * @param {CsvRow} r
 * @returns {string}
 */
function e1rmCell(r) {
  if (r.unit === 'level' || r.kind === 'bodyweight' || r.assisted) return '';
  return String(Math.round(e1rm(r.weight, r.reps) * 10) / 10);
}

/**
 * RFC 4180 CSV, CRLF line endings, local date/time, dot decimals.
 * @param {CsvRow[]} rows
 * @returns {string}
 */
export function setsToCsv(rows) {
  const lines = rows.map((r) => {
    const d = new Date(r.completedAt);
    return [
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      field(r.gym),
      field(r.exercise),
      field(r.category),
      field(r.machine),
      String(r.setNo),
      formatWeight(r.weight),
      String(r.reps),
      r.unit,
      r.baseWeight === null ? '' : formatWeight(r.baseWeight),
      e1rmCell(r),
      r.bodyweight == null ? '' : formatWeight(r.bodyweight),
    ].join(',');
  });
  return [CSV_HEADER, ...lines].join('\r\n') + '\r\n';
}
