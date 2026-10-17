import { describe, expect, test } from 'vitest';
import { e1rm, formatSummary, summarizeSets, volumeLoad } from './metrics';

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
});
