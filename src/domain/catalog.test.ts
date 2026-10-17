import { BUILT_IN_CATALOG, CATEGORIES } from './catalog';
const ids = BUILT_IN_CATALOG.map(e => e.id);
test('ids unique kebab-case', () => {
  expect(new Set(ids).size).toBe(ids.length);
  ids.forEach(id => expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/));
});
test('every category has ≥3 exercises', () =>
  CATEGORIES.forEach(c => expect(BUILT_IN_CATALOG.filter(e => e.category === c.id).length).toBeGreaterThanOrEqual(3)));
test('free/bodyweight have defaultLoading, machines do not', () =>
  BUILT_IN_CATALOG.forEach(e => expect(!!e.defaultLoading).toBe(e.kind !== 'machine')));
test('ids the plan relies on exist', () => {
  for (const id of ['leg-press','lat-pulldown','chest-press','seated-row','dumbbell-bench-press',
    'barbell-back-squat','pull-up','assisted-pull-up','one-arm-dumbbell-row']) expect(ids).toContain(id);
});
test('flags', () => {
  const by = (id: string) => BUILT_IN_CATALOG.find(e => e.id === id)!;
  expect(by('one-arm-dumbbell-row').unilateral).toBe(true);
  expect(by('assisted-pull-up').assisted).toBe(true);
  expect(by('pull-up').kind).toBe('bodyweight');
});
test('size and built-in flag', () => {
  expect(BUILT_IN_CATALOG.length).toBeGreaterThanOrEqual(60);
  expect(BUILT_IN_CATALOG.length).toBeLessThanOrEqual(80);
  BUILT_IN_CATALOG.forEach(e => expect(e.builtIn).toBe(true));
});
test('full body and core have real entries', () => {
  for (const id of ['deadlift','clean','thruster','kettlebell-swing','burpee','back-extension']) expect(ids).toContain(id);
  const by = (id: string) => BUILT_IN_CATALOG.find(e => e.id === id)!;
  expect(by('deadlift').category).toBe('fullbody');
  expect(by('back-extension').category).toBe('core');
});
