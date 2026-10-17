import { isoWeek } from './dates';
import type { CatalogExercise, Category, SetEntry } from './types';

export interface Slice {
  catalogId: string | null;
  category: Category | null;
  gymIds: string[];
  year: number | null;
  month: number | null;
  week: number | null;
}

export function emptySlice(): Slice {
  return { catalogId: null, category: null, gymIds: [], year: null, month: null, week: null };
}

export function filterSets(sets: SetEntry[], slice: Slice, catalog: CatalogExercise[]): SetEntry[] {
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

export function sliceOptions(sets: SetEntry[]): { years: number[]; months: number[]; weeks: number[] } {
  const years = new Set<number>();
  const months = new Set<number>();
  const weeks = new Set<number>();
  for (const s of sets) {
    const d = new Date(s.completedAt);
    years.add(d.getFullYear());
    months.add(d.getMonth() + 1);
    weeks.add(isoWeek(s.completedAt).week);
  }
  const asc = (a: number, b: number) => a - b;
  return { years: [...years].sort(asc), months: [...months].sort(asc), weeks: [...weeks].sort(asc) };
}
