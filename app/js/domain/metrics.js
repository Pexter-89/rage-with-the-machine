/** @typedef {{ weight: number, reps: number }} WR */

/**
 * Epley estimated one-rep max; reps = 1 gives the weight itself.
 * @param {number} weight
 * @param {number} reps
 * @returns {number}
 */
export function e1rm(weight, reps) {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * @param {WR[]} sets
 * @returns {number}
 */
export function volumeLoad(sets) {
  return sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
}

/**
 * @typedef {object} SetSummary
 * @property {number} count
 * @property {number} minWeight
 * @property {number} maxWeight
 * @property {number} minReps
 * @property {number} maxReps
 */

/**
 * @param {WR[]} sets
 * @returns {SetSummary | null}
 */
export function summarizeSets(sets) {
  if (sets.length === 0) return null;
  const weights = sets.map((s) => s.weight);
  const reps = sets.map((s) => s.reps);
  return {
    count: sets.length,
    minWeight: Math.min(...weights),
    maxWeight: Math.max(...weights),
    minReps: Math.min(...reps),
    maxReps: Math.max(...reps),
  };
}

/**
 * Weight text without trailing zeros: 62.5 -> "62.5", 60 -> "60".
 * @param {number} w
 * @returns {string}
 */
export function formatWeight(w) {
  return String(Math.round(w * 1000) / 1000);
}

/**
 * @param {number} a
 * @param {number} b
 */
const range = (a, b) => (a === b ? formatWeight(a) : `${formatWeight(a)}–${formatWeight(b)}`);

/**
 * @param {SetSummary} s
 * @param {Unit} unit
 * @returns {string}
 */
export function formatSummary(s, unit) {
  const sets = `${s.count} ${s.count === 1 ? 'set' : 'sets'}`;
  const reps = `${range(s.minReps, s.maxReps)} reps`;
  const weight = `${range(s.minWeight, s.maxWeight)} ${unit === 'level' ? 'L' : 'kg'}`;
  return [sets, reps, weight].join(' · ');
}

/**
 * One set as shown everywhere a set is listed, unit beside the weight: "50 kg × 8", "5 L × 12".
 * @param {WR & { unit: Unit }} s
 * @returns {string}
 */
export const formatSet = (s) => `${formatWeight(s.weight)} ${s.unit === 'level' ? 'L' : 'kg'} × ${s.reps}`;

/**
 * Every set in order, each with its unit so the last one never reads as "8 kg":
 * "60 kg × 10 · 62.5 kg × 8 · 65 kg × 6".
 * @param {(WR & { unit: Unit })[]} sets
 * @returns {string}
 */
export function formatSetList(sets) {
  return sets.map(formatSet).join(' · ');
}

/** @typedef {WR & { id: string, order: number, unit: Unit }} Ordered */

/**
 * Ids of this session's sets whose e1RM beats every earlier set: all of `history` (earlier sessions) and the
 * session's own sets before it. Nothing is a record without history, so a first session shows none.
 * @param {Ordered[]} current
 * @param {Ordered[]} history
 * @returns {Set<string>}
 */
export function recordSetIds(current, history) {
  const kg = (s) => s.unit === 'kg';
  const past = history.filter(kg);
  const ids = new Set();
  if (past.length === 0) return ids;
  let best = Math.max(...past.map((s) => e1rm(s.weight, s.reps)));
  for (const s of current.filter(kg).sort((a, b) => a.order - b.order)) {
    const v = e1rm(s.weight, s.reps);
    if (v > best + 1e-9) {
      ids.add(s.id);
      best = v;
    }
  }
  return ids;
}
