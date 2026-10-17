import { describe, expect, test } from 'vitest';
import { BUILT_IN_CATALOG } from './catalog';
import { extractMachineJson, parseMachineFile } from './importMachine';

const valid = `{"format":"rwtm-machine","version":1,"machines":[{"exercise":"leg-press","newExercise":null,"label":"Technogym","loading":{"type":"plate","base":62,"step":2.5},"notes":"Seat 5"}]}`;

const file = (machine: object, extra: object = {}) =>
  JSON.stringify({ format: 'rwtm-machine', version: 1, machines: [machine], ...extra });
const stack = (weights: unknown, unit?: string) => ({
  exercise: 'leg-press',
  loading: { type: 'stack', weights, ...(unit ? { unit } : {}) },
});
const err = (text: string) => {
  const r = parseMachineFile(text, BUILT_IN_CATALOG);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
};

describe('extractMachineJson', () => {
  test('plain JSON', () => expect(extractMachineJson(valid)).toMatchObject({ format: 'rwtm-machine' }));
  test('markdown with prose, a {brace} in prose and a fence', () =>
    expect(extractMachineJson(`Here you go {as asked}:\n\`\`\`json\n${valid}\n\`\`\`\nEnjoy!`)).toMatchObject({ version: 1 }));
  test('brace inside string value', () => expect(extractMachineJson(valid.replace('Seat 5', 'Seat } 5'))).not.toBeNull());
  test('escaped quote inside string value', () =>
    expect(extractMachineJson(valid.replace('Seat 5', 'Seat \\" } 5'))).toMatchObject({ format: 'rwtm-machine' }));
  test('curly quotes normalised', () => {
    const curly = valid.replace(/"([^"]*)"/g, '“$1”');
    expect(extractMachineJson(curly)).toMatchObject({ format: 'rwtm-machine' });
  });
  test('returns null when no machine JSON', () => {
    expect(extractMachineJson('hello {"a":1} world')).toBeNull();
    expect(extractMachineJson('')).toBeNull();
  });
  test('skips earlier objects with another format', () =>
    expect(extractMachineJson(`{"format":"other"} ${valid}`)).toMatchObject({ format: 'rwtm-machine' }));
});

describe('parseMachineFile', () => {
  test('valid file parses to machines', () => {
    const r = parseMachineFile(valid, BUILT_IN_CATALOG);
    expect(r).toEqual({
      ok: true,
      newExercises: [],
      machines: [{ catalogId: 'leg-press', label: 'Technogym', notes: 'Seat 5', loading: { type: 'plate', base: 62, step: 2.5 } }],
    });
  });
  test('no machine JSON → error', () => expect(err('nothing here')).toMatch(/rwtm-machine/));
  test('unknown exercise id → error naming the id', () =>
    expect(err(file({ exercise: 'nope-press', loading: { type: 'plate', base: 0, step: 5 } }))).toBe(
      'Machine 1: unknown exercise "nope-press"',
    ));
  test('newExercise accepted and returned as custom (builtIn false), deduplicated', () => {
    const ne = { id: 'hip-thing', name: 'Hip Thing', category: 'legs', kind: 'machine' };
    const m = { exercise: 'hip-thing', newExercise: ne, loading: { type: 'plate', base: 10, step: 5 } };
    const r = parseMachineFile(file(m, { machines: [m, { ...m, label: 'B' }] }), BUILT_IN_CATALOG);
    expect(r).toMatchObject({ ok: true, newExercises: [{ ...ne, builtIn: false }] });
    expect(r.ok && r.newExercises).toHaveLength(1);
    expect(r.ok && r.machines.map((x) => x.catalogId)).toEqual(['hip-thing', 'hip-thing']);
  });
  test('newExercise rules', () => {
    const base = { id: 'hip-thing', name: 'Hip Thing', category: 'legs', kind: 'machine' };
    const run = (ne: unknown, exercise = 'hip-thing') =>
      err(file({ exercise, newExercise: ne, loading: { type: 'plate', base: 0, step: 5 } }));
    expect(run({ ...base, kind: 'free' })).toMatch(/^Machine 1: newExercise kind/);
    expect(run({ ...base, category: 'toes' })).toMatch(/^Machine 1: newExercise category/);
    expect(run({ ...base, id: 'Hip Thing' }, 'Hip Thing')).toMatch(/^Machine 1: newExercise id/);
    expect(run({ ...base, extra: 1 })).toBe('Machine 1: unknown newExercise field "extra"');
    expect(run({ ...base, name: '' })).toMatch(/^Machine 1: newExercise name/);
    expect(run({ ...base, id: 'leg-press' }, 'leg-press')).toMatch(/already exists/);
    expect(run(base, 'leg-press')).toMatch(/^Machine 1: exercise must equal newExercise id/);
  });
  test('conflicting definitions of the same newExercise → error', () => {
    const ne = { id: 'hip-thing', name: 'Hip Thing', category: 'legs', kind: 'machine' };
    const m = { exercise: 'hip-thing', newExercise: ne, loading: { type: 'plate', base: 10, step: 5 } };
    expect(err(file(m, { machines: [m, { ...m, newExercise: { ...ne, name: 'Other' } }] }))).toMatch(/^Machine 2:/);
  });
  test('unknown field', () =>
    expect(err(file({ exercise: 'leg-press', loading: { type: 'plate', base: 0, step: 5 }, foo: 1 }))).toBe(
      'Machine 1: unknown field "foo"',
    ));
  test('label and notes must be strings', () => {
    expect(err(file({ ...stack([5]), label: 3 }))).toBe('Machine 1: label must be a string');
    expect(err(file({ ...stack([5]), notes: [] }))).toBe('Machine 1: notes must be a string');
  });
  test('missing label/notes default to empty', () => {
    const r = parseMachineFile(file(stack([5])), BUILT_IN_CATALOG);
    expect(r.ok && r.machines[0]).toMatchObject({ label: '', notes: '' });
  });
  test('stack weights: empty, non-positive, duplicate, too many, non-numbers', () => {
    expect(err(file(stack([])))).toMatch(/^Machine 1: stack weights/);
    expect(err(file(stack([0, 5])))).toMatch(/^Machine 1: stack weights/);
    expect(err(file(stack([5, 5])))).toMatch(/^Machine 1: stack weights/);
    expect(err(file(stack(['5'])))).toMatch(/^Machine 1: stack weights/);
    expect(err(file(stack(Array.from({ length: 201 }, (_, i) => i + 1))))).toMatch(/at most 200/);
    expect(parseMachineFile(file(stack(Array.from({ length: 200 }, (_, i) => i + 1))), BUILT_IN_CATALOG).ok).toBe(true);
  });
  test('stack weights are sorted ascending', () => {
    const r = parseMachineFile(file(stack([10, 5, 7.5])), BUILT_IN_CATALOG);
    expect(r.ok && r.machines[0].loading).toEqual({ type: 'stack', weights: [5, 7.5, 10] });
  });
  test('level stack accepted; bad unit rejected', () => {
    const r = parseMachineFile(file(stack([1, 2, 3], 'level')), BUILT_IN_CATALOG);
    expect(r.ok && r.machines[0].loading).toEqual({ type: 'stack', weights: [1, 2, 3], unit: 'level' });
    expect(err(file(stack([1], 'lb')))).toMatch(/^Machine 1: stack unit/);
  });
  test('plate rules', () => {
    const p = (base: unknown, step: unknown) => err(file({ exercise: 'leg-press', loading: { type: 'plate', base, step } }));
    expect(p(62, 0.1)).toBe('Machine 1: plate step must be at least 0.25');
    expect(p(62, 0)).toBe('Machine 1: plate step must be at least 0.25');
    expect(p(-1, 2.5)).toMatch(/^Machine 1: plate base/);
    expect(p('62', 2.5)).toMatch(/^Machine 1: plate base/);
    expect(
      parseMachineFile(file({ exercise: 'leg-press', loading: { type: 'plate', base: 0, step: 0.25 } }), BUILT_IN_CATALOG).ok,
    ).toBe(true);
  });
  test('loading type and unknown loading fields', () => {
    expect(err(file({ exercise: 'leg-press', loading: { type: 'free' } }))).toMatch(/^Machine 1: loading type/);
    expect(err(file({ exercise: 'leg-press' }))).toMatch(/^Machine 1: loading/);
    expect(err(file({ exercise: 'leg-press', loading: { type: 'plate', base: 0, step: 5, x: 1 } }))).toBe(
      'Machine 1: unknown loading field "x"',
    );
  });
  test('machine number in error', () => {
    const second = { exercise: 'zzz', loading: { type: 'plate', base: 0, step: 5 } };
    expect(err(file(stack([5]), { machines: [stack([5]), second] }))).toMatch(/^Machine 2:/);
  });
  test('version 2, empty or missing machines → error', () => {
    expect(err(file(stack([5]), { version: 2 }))).toMatch(/version/);
    expect(err(file(stack([5]), { machines: [] }))).toMatch(/machines/);
    expect(err(file(stack([5]), { machines: 'x' }))).toMatch(/machines/);
  });
  test('JSON null newExercise means none', () =>
    expect(parseMachineFile(file({ ...stack([5]), newExercise: null }), BUILT_IN_CATALOG).ok).toBe(true));
});
