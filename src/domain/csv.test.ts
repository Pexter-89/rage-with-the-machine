import { describe, expect, test } from 'vitest';
import { setsToCsv, type CsvRow } from './csv';

const base: CsvRow = {
  completedAt: new Date(2026, 9, 17, 17, 42).getTime(),
  gym: 'Gym, "Big"',
  exercise: 'Leg Press',
  category: 'Legs',
  machine: 'Technogym',
  setNo: 1,
  weight: 92,
  reps: 10,
  unit: 'kg',
  baseWeight: 62,
};

describe('setsToCsv', () => {
  test('csv header and quoting', () => {
    const csv = setsToCsv([base]);
    expect(csv.split('\r\n')[0]).toBe('date,time,gym,exercise,category,machine,set,weight,reps,unit,base_weight,e1rm,bodyweight');
    expect(csv.split('\r\n')[1]).toBe('2026-10-17,17:42,"Gym, ""Big""",Leg Press,Legs,Technogym,1,92,10,kg,62,122.7,');
  });

  test('quotes fields with newlines', () => {
    expect(setsToCsv([{ ...base, gym: 'a\nb' }]).split('\r\n').slice(1).join('\r\n')).toContain('"a\nb"');
  });

  test('e1rm empty for level, bodyweight and assisted; no trailing .0', () => {
    const e = (r: Partial<CsvRow>) => setsToCsv([{ ...base, ...r }]).split('\r\n')[1].split(',').at(-2);
    expect(e({ unit: 'level', gym: 'g' })).toBe('');
    expect(e({ kind: 'bodyweight', gym: 'g' })).toBe('');
    expect(e({ assisted: true, gym: 'g' })).toBe('');
    expect(e({ reps: 1, weight: 100, gym: 'g' })).toBe('100');
    expect(e({ kind: 'machine', gym: 'g' })).toBe('122.7');
  });

  test('empty baseWeight and machine give empty fields; ends with CRLF', () => {
    const csv = setsToCsv([{ ...base, gym: 'g', machine: '', baseWeight: null }]);
    expect(csv.split('\r\n')[1]).toBe('2026-10-17,17:42,g,Leg Press,Legs,,1,92,10,kg,,122.7,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('the session body weight is the last column when noted', () => {
    expect(setsToCsv([{ ...base, gym: 'g', bodyweight: 82.5 }]).split('\r\n')[1].split(',').pop()).toBe('82.5');
  });
});
