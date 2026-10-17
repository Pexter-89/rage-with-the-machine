import { describe, expect, test } from 'vitest';
import type { CatalogExercise, SetEntry } from './types';
import { buildSeries, buildTableRows, gymColor } from './progress';

let n = 0;
const mkSet = (p: Partial<SetEntry> = {}): SetEntry => ({
  id: `s${n++}`, sessionId: 'a', gymId: 'g1', catalogId: 'x', gymExerciseId: null,
  order: 0, weight: 50, reps: 10, baseWeight: null, unit: 'kg', completedAt: 1000, ...p,
});
const free: CatalogExercise = { id: 'x', name: 'X', category: 'legs', kind: 'free', builtIn: true };
const bw: CatalogExercise = { ...free, kind: 'bodyweight' };
const assisted: CatalogExercise = { ...free, kind: 'bodyweight', assisted: true };

describe('buildSeries', () => {
  const sets = [
    mkSet({ sessionId: 'b', gymId: 'g2', completedAt: 2000, weight: 100, reps: 5 }),
    mkSet({ sessionId: 'b', gymId: 'g2', completedAt: 2100, weight: 80, reps: 10, order: 1 }),
    mkSet({ sessionId: 'a', gymId: 'g1', completedAt: 1000, weight: 60, reps: 10 }),
  ];
  test('e1rm: one point per session, best set, sorted by date, carries gymId', () => {
    const r = buildSeries(sets, free, 'e1rm');
    expect(r.metric).toBe('e1rm');
    expect(r.points.map((p) => [p.sessionId, p.gymId, p.date])).toEqual([['a', 'g1', 1000], ['b', 'g2', 2000]]);
    expect(r.points[0].value).toBeCloseTo(80, 5);
    expect(r.points[1].value).toBeCloseTo(100 * (1 + 5 / 30), 5); // 116.67 > 80*(1+10/30)=106.67
  });
  test('volume: sum per session', () => {
    const r = buildSeries(sets, free, 'volume');
    expect(r.metric).toBe('volume');
    expect(r.points.map((p) => p.value)).toEqual([600, 1300]);
  });
  test('bodyweight exercise → metric reps, value = total reps', () => {
    for (const requested of ['e1rm', 'volume'] as const) {
      const r = buildSeries(sets, bw, requested);
      expect(r.metric).toBe('reps');
      expect(r.points.map((p) => p.value)).toEqual([10, 15]);
    }
  });
  test('assisted exercise → metric assist, value = min weight', () => {
    const r = buildSeries(sets, assisted, 'e1rm');
    expect(r.metric).toBe('assist');
    expect(r.points.map((p) => p.value)).toEqual([60, 80]);
  });
  test('level-unit sets are excluded from series', () => {
    const withLevel = [...sets, mkSet({ sessionId: 'c', completedAt: 3000, weight: 9, reps: 10, unit: 'level' })];
    expect(buildSeries(withLevel, free, 'volume').points).toHaveLength(2);
    expect(buildSeries(withLevel, bw, 'volume').points).toHaveLength(2);
  });
  test('empty input gives no points', () => {
    expect(buildSeries([], free, 'e1rm')).toEqual({ metric: 'e1rm', points: [] });
  });
});

describe('buildTableRows', () => {
  const sets = [
    mkSet({ sessionId: 'a', completedAt: 1000, weight: 62, reps: 10, order: 0 }),
    mkSet({ sessionId: 'a', completedAt: 1100, weight: 72, reps: 8, order: 1 }),
    mkSet({ sessionId: 'b', gymId: 'g2', completedAt: 5000, weight: 62.5, reps: 10 }),
  ];
  test('newest first, setsText "62×10, 72×8", volume and bestE1rm', () => {
    const rows = buildTableRows(sets, free);
    expect(rows.map((r) => r.sessionId)).toEqual(['b', 'a']);
    expect(rows[0]).toMatchObject({ gymId: 'g2', date: 5000, setsText: '62.5×10' });
    expect(rows[1].setsText).toBe('62×10, 72×8');
    expect(rows[1].volume).toBe(1196);
    expect(rows[1].bestE1rm).toBeCloseTo(72 * (1 + 8 / 30), 5);
  });
  test('level sets shown with L suffix, excluded from volume and bestE1rm', () => {
    const rows = buildTableRows([mkSet({ weight: 7, reps: 10, unit: 'level' }), mkSet({ weight: 60, reps: 10, order: 1 })], free);
    expect(rows[0].setsText).toBe('7 L×10, 60×10');
    expect(rows[0].volume).toBe(600);
    expect(rows[0].bestE1rm).toBeCloseTo(80, 5);
    const only = buildTableRows([mkSet({ weight: 7, reps: 10, unit: 'level' })], free);
    expect(only[0]).toMatchObject({ setsText: '7 L×10', volume: 0, bestE1rm: null });
  });
  test('bestE1rm null for bodyweight and assisted', () => {
    expect(buildTableRows(sets, bw)[0].bestE1rm).toBeNull();
    expect(buildTableRows(sets, assisted)[0].bestE1rm).toBeNull();
  });
});

describe('gymColor', () => {
  test('8-colour palette, wraps around', () => {
    const colors = new Set(Array.from({ length: 8 }, (_, i) => gymColor(i)));
    expect(colors.size).toBe(8);
    expect(gymColor(8)).toBe(gymColor(0));
    expect(gymColor(0)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
