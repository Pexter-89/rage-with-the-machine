import { describe, expect, test } from 'vitest';
import { formatDate, formatTime, isoWeek } from './dates';

describe('dates', () => {
  test('isoWeek', () => {
    expect(isoWeek(new Date(2026, 0, 1).getTime())).toEqual({ year: 2026, week: 1 });
    expect(isoWeek(new Date(2024, 11, 30).getTime())).toEqual({ year: 2025, week: 1 });
    expect(isoWeek(new Date(2027, 0, 1).getTime())).toEqual({ year: 2026, week: 53 });
  });
  test('formatDate and formatTime', () => {
    expect(formatDate(new Date(2026, 9, 10, 17, 42).getTime())).toBe('10 Oct 2026');
    expect(formatDate(new Date(2026, 0, 5).getTime())).toBe('5 Jan 2026');
    expect(formatTime(new Date(2026, 9, 10, 17, 42).getTime())).toBe('17:42');
    expect(formatTime(new Date(2026, 9, 10, 7, 5).getTime())).toBe('07:05');
  });
});
