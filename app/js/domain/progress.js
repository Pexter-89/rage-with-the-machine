import { e1rm, formatWeight, volumeLoad } from './metrics.js';

/** @typedef {'e1rm' | 'volume' | 'reps' | 'assist'} MetricKind */

/**
 * @typedef {object} ProgressPoint
 * @property {string} sessionId
 * @property {number} date
 * @property {string} gymId
 * @property {number} value
 */

/**
 * @typedef {object} TableRow
 * @property {string} sessionId
 * @property {number} date
 * @property {string} gymId
 * @property {string} setsText
 * @property {number | null} bestE1rm
 * @property {number} volume
 */

/**
 * @typedef {object} SessionGroup
 * @property {string} sessionId
 * @property {number} date
 * @property {string} gymId
 * @property {SetEntry[]} sets
 */

/**
 * Groups sets by session (sets ordered by `order`, then time); date = earliest completion.
 * @param {SetEntry[]} sets
 * @returns {SessionGroup[]}
 */
function groupBySession(sets) {
  const groups = new Map();
  for (const s of sets) {
    const g = groups.get(s.sessionId);
    if (g) {
      g.sets.push(s);
      g.date = Math.min(g.date, s.completedAt);
    } else {
      groups.set(s.sessionId, { sessionId: s.sessionId, date: s.completedAt, gymId: s.gymId, sets: [s] });
    }
  }
  for (const g of groups.values()) {
    g.sets.sort((a, b) => a.order - b.order || a.completedAt - b.completedAt);
  }
  return [...groups.values()];
}

/**
 * @param {SetEntry[]} sets
 * @param {CatalogExercise} ex
 * @param {'e1rm' | 'volume'} requested
 * @returns {{ metric: MetricKind, points: ProgressPoint[] }}
 */
export function buildSeries(sets, ex, requested) {
  const metric = ex.assisted ? 'assist' : ex.kind === 'bodyweight' ? 'reps' : requested;
  const kgSets = sets.filter((s) => s.unit !== 'level');
  const value = (group) => {
    switch (metric) {
      case 'assist':
        return Math.min(...group.map((s) => s.weight));
      case 'reps':
        return group.reduce((sum, s) => sum + s.reps, 0);
      case 'volume':
        return volumeLoad(group);
      default:
        return Math.max(...group.map((s) => e1rm(s.weight, s.reps)));
    }
  };
  const points = groupBySession(kgSets)
    .map((g) => ({ sessionId: g.sessionId, date: g.date, gymId: g.gymId, value: value(g.sets) }))
    .sort((a, b) => a.date - b.date);
  return { metric, points };
}

/**
 * @param {SetEntry[]} sets
 * @param {CatalogExercise} ex
 * @returns {TableRow[]}
 */
export function buildTableRows(sets, ex) {
  const noE1rm = ex.kind === 'bodyweight' || !!ex.assisted;
  return groupBySession(sets)
    .map((g) => {
      const kg = g.sets.filter((s) => s.unit !== 'level');
      const setsText = g.sets
        .map((s) => `${formatWeight(s.weight)}${s.unit === 'level' ? ' L' : ''}×${s.reps}`)
        .join(', ');
      const bestE1rm = noE1rm || kg.length === 0 ? null : Math.max(...kg.map((s) => e1rm(s.weight, s.reps)));
      return { sessionId: g.sessionId, date: g.date, gymId: g.gymId, setsText, bestE1rm, volume: volumeLoad(kg) };
    })
    .sort((a, b) => b.date - a.date);
}

const GYM_COLORS = ['#4f9dff', '#ff8a3d', '#3ecf8e', '#e5539b', '#f2c94c', '#9b7bff', '#2ec4c4', '#ef5350'];

/**
 * @param {number} index
 * @returns {string}
 */
export function gymColor(index) {
  return GYM_COLORS[((index % GYM_COLORS.length) + GYM_COLORS.length) % GYM_COLORS.length];
}

/**
 * @param {SetEntry[]} sets
 * @param {CatalogExercise[]} catalog
 * @returns {{ sessionId: string, date: number, gymId: string, exercises: string[] }[]}
 */
export function buildSessionList(sets, catalog) {
  const nameById = new Map(catalog.map((c) => [c.id, c.name]));
  return groupBySession(sets)
    .map((g) => {
      const names = [];
      for (const s of g.sets) {
        const n = nameById.get(s.catalogId) ?? s.catalogId;
        if (!names.includes(n)) names.push(n);
      }
      return { sessionId: g.sessionId, date: g.date, gymId: g.gymId, exercises: names };
    })
    .sort((a, b) => b.date - a.date);
}

// ---- body weight ----

const DAY_MS = 24 * 60 * 60 * 1000;
/** The rolling-average window: four weeks. */
export const BW_WINDOW_MS = 28 * DAY_MS;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * One point per session that has a body weight, oldest first (date = the session's start).
 * @param {Session[]} sessions
 * @returns {ProgressPoint[]}
 */
export function bodyweightPoints(sessions) {
  return sessions
    .filter((s) => typeof s.bodyweight === 'number' && Number.isFinite(s.bodyweight))
    .map((s) => ({ sessionId: s.id, date: s.startedAt, gymId: s.gymId, value: /** @type {number} */ (s.bodyweight) }))
    .sort((a, b) => a.date - b.date);
}

/**
 * Average of each point and the points in the four weeks before it (rounded to 0.1 kg), for a trend line.
 * @param {ProgressPoint[]} points Oldest first.
 * @returns {{ date: number, value: number }[]}
 */
export function rollingAverage(points) {
  return points.map((p, i) => {
    const window = points.slice(0, i + 1).filter((q) => q.date > p.date - BW_WINDOW_MS);
    return { date: p.date, value: round1(window.reduce((sum, q) => sum + q.value, 0) / window.length) };
  });
}

/**
 * @typedef {object} BodyweightSummary
 * @property {number} latest The newest body weight.
 * @property {number} latestDate
 * @property {number | null} change Newest minus oldest in the points given (null with one point).
 * @property {number} average4w Average over the four weeks up to the newest point.
 */

/**
 * @param {ProgressPoint[]} points Oldest first.
 * @returns {BodyweightSummary | null}
 */
export function bodyweightSummary(points) {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const avg = rollingAverage(points);
  return {
    latest: last.value,
    latestDate: last.date,
    change: points.length > 1 ? round1(last.value - points[0].value) : null,
    average4w: avg[avg.length - 1].value,
  };
}
