import { describe, expect, test } from 'vitest';
import { e1rm, formatSetList, formatSummary, recordSetIds, summarizeSets, volumeLoad } from './metrics';

describe('metrics', () => {
  test('e1rm uses Epley, reps 1 = weight, reps 0 = 0', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 10)).toBeCloseTo(133.33, 2);
    expect(e1rm(100, 0)).toBe(0);
  });
  test('volumeLoad sums weight x reps', () => {
    expect(volumeLoad([{ weight: 62, reps: 10 }, { weight: 72, reps: 8 }])).toBe(1196);
    expect(volumeLoad([])).toBe(0);
  });
  test('summarizeSets', () => {
    expect(summarizeSets([{ weight: 62, reps: 10 }, { weight: 72, reps: 8 }])).toEqual({
      count: 2, minWeight: 62, maxWeight: 72, minReps: 8, maxReps: 10,
    });
    expect(summarizeSets([])).toBeNull();
  });
  test('formatSummary', () => {
    expect(formatSummary({ count: 3, minWeight: 92, maxWeight: 112, minReps: 8, maxReps: 12 }, 'kg')).toBe('3 sets · 8–12 reps · 92–112 kg');
    expect(formatSummary({ count: 1, minWeight: 50, maxWeight: 50, minReps: 10, maxReps: 10 }, 'kg')).toBe('1 set · 10 reps · 50 kg');
    expect(formatSummary({ count: 2, minWeight: 7, maxWeight: 9, minReps: 10, maxReps: 10 }, 'level')).toBe('2 sets · 10 reps · 7–9 L');
    expect(formatSummary({ count: 2, minWeight: 62.5, maxWeight: 70, minReps: 8, maxReps: 8 }, 'kg')).toBe('2 sets · 8 reps · 62.5–70 kg');
  });
  test('formatSetList lists every set with one unit', () => {
    expect(formatSetList([{ weight: 60, reps: 10, unit: 'kg' }, { weight: 62.5, reps: 8, unit: 'kg' }])).toBe('60×10 · 62.5×8 kg');
    expect(formatSetList([{ weight: 7, reps: 12, unit: 'level' }])).toBe('7×12 L');
    expect(formatSetList([])).toBe('');
  });
});

describe('recordSetIds', () => {
  const set = (id: string, weight: number, reps: number, order = 1, unit: 'kg' | 'level' = 'kg') => ({ id, weight, reps, order, unit });

  test('marks sets whose e1RM beats all history and the earlier sets of the session', () => {
    const history = [set('h1', 60, 10), set('h2', 65, 8)]; // best e1RM 82.3
    const current = [set('a', 60, 10, 1), set('b', 70, 6, 2), set('c', 70, 7, 3), set('d', 70, 6, 4)];
    expect([...recordSetIds(current, history)]).toEqual(['b', 'c']);
  });

  test('equalling the best is not a record', () => {
    expect(recordSetIds([set('a', 65, 8)], [set('h', 65, 8)]).size).toBe(0);
  });

  test('no history, or only level sets, gives no records', () => {
    expect(recordSetIds([set('a', 100, 5)], []).size).toBe(0);
    expect(recordSetIds([set('a', 100, 5)], [set('h', 3, 5, 1, 'level')]).size).toBe(0);
    expect(recordSetIds([set('a', 9, 5, 1, 'level')], [set('h', 3, 5)]).size).toBe(0);
  });
});
