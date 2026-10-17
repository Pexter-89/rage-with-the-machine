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
