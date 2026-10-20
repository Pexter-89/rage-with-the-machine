import type { Unit } from './types';

type WR = { weight: number; reps: number };

/** Epley estimated one-rep max; reps = 1 gives the weight itself. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function volumeLoad(sets: WR[]): number {
  return sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
}

export interface SetSummary {
  count: number;
  minWeight: number;
  maxWeight: number;
  minReps: number;
  maxReps: number;
}

export function summarizeSets(sets: WR[]): SetSummary | null {
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

/** Weight text without trailing zeros: 62.5 -> "62.5", 60 -> "60". */
export function formatWeight(w: number): string {
  return String(Math.round(w * 1000) / 1000);
}

const range = (a: number, b: number) => (a === b ? formatWeight(a) : `${formatWeight(a)}–${formatWeight(b)}`);

export function formatSummary(s: SetSummary, unit: Unit): string {
  const sets = `${s.count} ${s.count === 1 ? 'set' : 'sets'}`;
  const reps = `${range(s.minReps, s.maxReps)} reps`;
  const weight = `${range(s.minWeight, s.maxWeight)} ${unit === 'level' ? 'L' : 'kg'}`;
  return [sets, reps, weight].join(' · ');
}

/** Every set in order, one unit at the end: "60×10 · 62.5×8 · 65×6 kg". */
export function formatSetList(sets: (WR & { unit: Unit })[]): string {
  if (sets.length === 0) return '';
  const list = sets.map((s) => `${formatWeight(s.weight)}×${s.reps}`).join(' · ');
  return `${list} ${sets[0].unit === 'level' ? 'L' : 'kg'}`;
}

type Ordered = WR & { id: string; order: number; unit: Unit };

/**
 * Ids of this session's sets whose e1RM beats every earlier set: all of `history` (earlier sessions) and the
 * session's own sets before it. Nothing is a record without history, so a first session shows none.
 */
export function recordSetIds(current: Ordered[], history: Ordered[]): Set<string> {
  const kg = (s: Ordered) => s.unit === 'kg';
  const past = history.filter(kg);
  const ids = new Set<string>();
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
