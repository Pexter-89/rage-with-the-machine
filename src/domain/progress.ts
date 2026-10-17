import { e1rm, formatWeight, volumeLoad } from './metrics';
import type { CatalogExercise, SetEntry } from './types';

export type MetricKind = 'e1rm' | 'volume' | 'reps' | 'assist';

export interface ProgressPoint {
  sessionId: string;
  date: number;
  gymId: string;
  value: number;
}

export interface TableRow {
  sessionId: string;
  date: number;
  gymId: string;
  setsText: string;
  bestE1rm: number | null;
  volume: number;
}

interface SessionGroup {
  sessionId: string;
  date: number;
  gymId: string;
  sets: SetEntry[];
}

/** Groups sets by session (sets ordered by `order`, then time); date = earliest completion. */
function groupBySession(sets: SetEntry[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
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

export function buildSeries(
  sets: SetEntry[],
  ex: CatalogExercise,
  requested: 'e1rm' | 'volume',
): { metric: MetricKind; points: ProgressPoint[] } {
  const metric: MetricKind = ex.assisted ? 'assist' : ex.kind === 'bodyweight' ? 'reps' : requested;
  const kgSets = sets.filter((s) => s.unit !== 'level');
  const value = (group: SetEntry[]): number => {
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

export function buildTableRows(sets: SetEntry[], ex: CatalogExercise): TableRow[] {
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

export function gymColor(index: number): string {
  return GYM_COLORS[((index % GYM_COLORS.length) + GYM_COLORS.length) % GYM_COLORS.length];
}

export function buildSessionList(
  sets: SetEntry[],
  catalog: CatalogExercise[],
): { sessionId: string; date: number; gymId: string; exercises: string[] }[] {
  const nameById = new Map(catalog.map((c) => [c.id, c.name]));
  return groupBySession(sets)
    .map((g) => {
      const names: string[] = [];
      for (const s of g.sets) {
        const n = nameById.get(s.catalogId) ?? s.catalogId;
        if (!names.includes(n)) names.push(n);
      }
      return { sessionId: g.sessionId, date: g.date, gymId: g.gymId, exercises: names };
    })
    .sort((a, b) => b.date - a.date);
}
