import { describe, expect, test } from 'vitest';
import type { CatalogExercise, SetEntry } from './types';
import { emptySlice, filterSets, sliceOptions } from './slicing';

let n = 0;
const mkSet = (p: Partial<SetEntry> & { at: number }): SetEntry => {
  const { at, ...rest } = p;
  return {
    id: `s${n++}`, sessionId: 'x', gymId: 'g1', catalogId: 'squat', gymExerciseId: null,
    order: 0, weight: 50, reps: 10, baseWeight: null, unit: 'kg', completedAt: at, ...rest,
  };
};
const ex = (id: string, category: CatalogExercise['category']): CatalogExercise => ({
  id, name: id, category, kind: 'free', builtIn: true,
});
const catalog = [ex('squat', 'legs'), ex('bench', 'chest')];
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12).getTime();

const sets = [
  mkSet({ at: d(2026, 12, 20), gymId: 'g1', catalogId: 'squat' }),
  mkSet({ at: d(2026, 12, 28), gymId: 'g2', catalogId: 'bench' }),
  mkSet({ at: d(2027, 1, 1), gymId: 'g2', catalogId: 'squat' }),
  mkSet({ at: d(2027, 1, 10), gymId: 'g1', catalogId: 'bench' }),
];
const ids = (r: SetEntry[]) => r.map((s) => s.id);

describe('slicing', () => {
  test('empty slice keeps everything', () => {
    expect(filterSets(sets, emptySlice(), catalog)).toHaveLength(4);
  });
  test('gym filter, empty gymIds = all', () => {
    expect(ids(filterSets(sets, { ...emptySlice(), gymIds: ['g2'] }, catalog))).toEqual([sets[1].id, sets[2].id]);
    expect(filterSets(sets, { ...emptySlice(), gymIds: [] }, catalog)).toHaveLength(4);
    expect(filterSets(sets, { ...emptySlice(), gymIds: ['g1', 'g2'] }, catalog)).toHaveLength(4);
  });
  test('catalogId filter', () => {
    expect(filterSets(sets, { ...emptySlice(), catalogId: 'bench' }, catalog)).toHaveLength(2);
  });
  test('year+month', () => {
    expect(ids(filterSets(sets, { ...emptySlice(), year: 2027, month: 1 }, catalog))).toEqual([sets[2].id, sets[3].id]);
    expect(ids(filterSets(sets, { ...emptySlice(), year: 2026, month: 12 }, catalog))).toEqual([sets[0].id, sets[1].id]);
    expect(filterSets(sets, { ...emptySlice(), year: 2026 }, catalog)).toHaveLength(2);
  });
  test('week uses ISO year: year 2026 + week 53 matches 2027-01-01', () => {
    const r = filterSets(sets, { ...emptySlice(), year: 2026, week: 53 }, catalog);
    expect(ids(r)).toEqual([sets[1].id, sets[2].id]); // 28 Dec 2026 and 1 Jan 2027 are both in 2026-W53
    expect(filterSets(sets, { ...emptySlice(), year: 2027, week: 53 }, catalog)).toHaveLength(0);
  });
  test('category filter keeps only exercises in category', () => {
    const r = filterSets(sets, { ...emptySlice(), category: 'chest' }, catalog);
    expect(ids(r)).toEqual([sets[1].id, sets[3].id]);
  });
  test('sliceOptions lists years, months, weeks present, ascending', () => {
    expect(sliceOptions(sets)).toEqual({ years: [2026, 2027], months: [1, 12], weeks: [1, 51, 53] });
    expect(sliceOptions([])).toEqual({ years: [], months: [], weeks: [] });
  });
});
