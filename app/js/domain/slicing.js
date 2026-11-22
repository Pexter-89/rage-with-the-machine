import { isoWeek } from './dates.js';

/**
 * @typedef {object} Slice
 * @property {string | null} catalogId
 * @property {Category | null} category
 * @property {string[]} gymIds
 * @property {number | null} year
 * @property {number | null} month
 * @property {number | null} week
 */

/** @returns {Slice} */
export function emptySlice() {
  return { catalogId: null, category: null, gymIds: [], year: null, month: null, week: null };
}

/**
 * @param {SetEntry[]} sets
 * @param {Slice} slice
 * @param {CatalogExercise[]} catalog
 * @returns {SetEntry[]}
 */
export function filterSets(sets, slice, catalog) {
  const categoryById = new Map(catalog.map((c) => [c.id, c.category]));
  return sets.filter((s) => {
    if (slice.catalogId !== null && s.catalogId !== slice.catalogId) return false;
    if (slice.category !== null && categoryById.get(s.catalogId) !== slice.category) return false;
    if (slice.gymIds.length > 0 && !slice.gymIds.includes(s.gymId)) return false;
    const d = new Date(s.completedAt);
    if (slice.week !== null) {
      const w = isoWeek(s.completedAt);
      if (w.week !== slice.week) return false;
      if (slice.year !== null && w.year !== slice.year) return false; // ISO year when a week is chosen
    } else if (slice.year !== null && d.getFullYear() !== slice.year) {
      return false;
    }
    if (slice.month !== null && d.getMonth() + 1 !== slice.month) return false;
    return true;
  });
}

/**
 * @param {SetEntry[]} sets
 * @returns {{ years: number[], months: number[], weeks: number[] }}
 */
export function sliceOptions(sets) {
  const years = new Set();
  const months = new Set();
  const weeks = new Set();
  for (const s of sets) {
    const d = new Date(s.completedAt);
    years.add(d.getFullYear());
    months.add(d.getMonth() + 1);
    weeks.add(isoWeek(s.completedAt).week);
  }
  const asc = (a, b) => a - b;
  return { years: [...years].sort(asc), months: [...months].sort(asc), weeks: [...weeks].sort(asc) };
}
