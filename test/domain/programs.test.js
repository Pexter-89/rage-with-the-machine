import { BUILT_IN_CATALOG } from '../../app/js/domain/catalog.js';
import {
  availabilityAt,
  clampItem,
  formatTarget,
  lastUsedMachine,
  median,
  planItemFor,
  planProgress,
  programAvailability,
  programFromSets,
  resolveAt,
  swapAlternatives,
} from '../../app/js/domain/programs.js';

const byId = new Map(BUILT_IN_CATALOG.map((e) => [e.id, e]));
const entry = (id) => byId.get(id);
const STACK = { type: 'stack', weights: [10, 20, 30] };
const ge = (id, catalogId, p = {}) => ({ id, gymId: 'g', catalogId, label: id, notes: '', loading: STACK, hidden: false, ...p });
let n = 0;
const set = (p) => ({
  id: `x${n++}`,
  sessionId: 's',
  gymId: 'g',
  catalogId: 'leg-press',
  gymExerciseId: null,
  order: 1,
  weight: 50,
  reps: 10,
  baseWeight: null,
  unit: 'kg',
  completedAt: 1000 + n,
  ...p,
});

describe('availabilityAt', () => {
  test('a machine exercise with one visible machine resolves to it', () => {
    const a = availabilityAt(entry('leg-press'), [ge('lp', 'leg-press'), ge('lat', 'lat-pulldown')]);
    expect(a).toMatchObject({ status: 'available', key: 'lp' });
  });

  test('several visible machines need a choice; hidden machines do not count', () => {
    const mine = [ge('b', 'lat-pulldown'), ge('a', 'lat-pulldown'), ge('h', 'lat-pulldown', { hidden: true })];
    const a = availabilityAt(entry('lat-pulldown'), mine);
    expect(a.status).toBe('choose');
    expect(a.key).toBeNull();
    expect(a.machines.map((m) => m.id)).toEqual(['a', 'b']);
    expect(availabilityAt(entry('lat-pulldown'), [ge('h', 'lat-pulldown', { hidden: true })]).status).toBe('missing');
  });

  test('a machine exercise with no machine here is missing', () => {
    expect(availabilityAt(entry('chest-press'), [ge('lp', 'leg-press')])).toEqual({
      status: 'missing',
      key: null,
      machines: [],
    });
  });

  test('free and bodyweight exercises are available everywhere, as the catalogue item', () => {
    expect(availabilityAt(entry('barbell-back-squat'), [])).toMatchObject({ status: 'available', key: 'c:barbell-back-squat' });
    expect(availabilityAt(entry('pull-up'), [])).toMatchObject({ status: 'available', key: 'c:pull-up' });
  });

  test("a gym's own free-weight setting is used, and Hide here makes it missing", () => {
    expect(availabilityAt(entry('dumbbell-curl'), [ge('own', 'dumbbell-curl')])).toMatchObject({ key: 'own' });
    expect(availabilityAt(entry('dumbbell-curl'), [ge('own', 'dumbbell-curl', { hidden: true })]).status).toBe('missing');
  });

  test('an unknown exercise (deleted custom entry) is missing', () => {
    expect(availabilityAt(undefined, []).status).toBe('missing');
  });
});

describe('machine choice', () => {
  test('lastUsedMachine is the machine of the latest set of the exercise at that gym', () => {
    const sets = [
      set({ catalogId: 'lat-pulldown', gymExerciseId: 'a', completedAt: 5 }),
      set({ catalogId: 'lat-pulldown', gymExerciseId: 'b', completedAt: 9 }),
      set({ catalogId: 'lat-pulldown', gymExerciseId: 'other-gym', gymId: 'g2', completedAt: 20 }),
      set({ catalogId: 'leg-press', gymExerciseId: 'lp', completedAt: 30 }),
      set({ catalogId: 'lat-pulldown', gymExerciseId: null, completedAt: 40 }),
    ];
    expect(lastUsedMachine(sets, 'lat-pulldown', 'g')).toBe('b');
    expect(lastUsedMachine(sets, 'chest-press', 'g')).toBeNull();
  });

  test('resolveAt picks the last used of several machines; with none used it asks', () => {
    const mine = [ge('a', 'lat-pulldown'), ge('b', 'lat-pulldown')];
    const used = [set({ catalogId: 'lat-pulldown', gymExerciseId: 'b' })];
    expect(resolveAt(entry('lat-pulldown'), mine, used, 'g')).toMatchObject({ status: 'available', key: 'b' });
    expect(resolveAt(entry('lat-pulldown'), mine, [], 'g').status).toBe('choose');
  });

  test('a last used machine that is now hidden or gone means asking again', () => {
    const mine = [ge('a', 'lat-pulldown'), ge('b', 'lat-pulldown'), ge('c', 'lat-pulldown', { hidden: true })];
    const used = [set({ catalogId: 'lat-pulldown', gymExerciseId: 'c' })];
    expect(resolveAt(entry('lat-pulldown'), mine, used, 'g').status).toBe('choose');
  });

  test('resolveAt leaves single machines, free weights and missing exercises as they are', () => {
    expect(resolveAt(entry('leg-press'), [ge('lp', 'leg-press')], [], 'g').key).toBe('lp');
    expect(resolveAt(entry('pull-up'), [], [], 'g').key).toBe('c:pull-up');
    expect(resolveAt(entry('chest-press'), [], [], 'g').status).toBe('missing');
  });
});

test('programAvailability counts the exercises a gym lacks', () => {
  const items = [
    { catalogId: 'leg-press', sets: 3, reps: 10 },
    { catalogId: 'chest-press', sets: 3, reps: 10 },
    { catalogId: 'pull-up', sets: 3, reps: 8 },
    { catalogId: 'gone-custom', sets: 2, reps: 8 },
  ];
  expect(programAvailability(items, byId, [ge('lp', 'leg-press')])).toEqual({ count: 4, missing: 2 });
  expect(programAvailability([], byId, [])).toEqual({ count: 0, missing: 0 });
});

describe('swapAlternatives', () => {
  test('same category, available here, machines first then by name, without the exercise and the rest of the plan', () => {
    const mine = [ge('row', 'seated-row'), ge('lp', 'leg-press'), ge('h', 'cable-row', { hidden: true })];
    const alts = swapAlternatives(entry('lat-pulldown'), BUILT_IN_CATALOG, mine, ['pull-up']).map((e) => e.id);
    expect(alts[0]).toBe('seated-row');
    expect(alts).not.toContain('lat-pulldown');
    expect(alts).not.toContain('pull-up');
    expect(alts).not.toContain('cable-row');
    expect(alts).not.toContain('leg-press');
    expect(alts).toContain('chin-up');
    expect(alts.every((id) => entry(id).category === 'back')).toBe(true);
    const free = alts.slice(1).map((id) => entry(id).name);
    expect(free).toEqual([...free].sort((a, b) => a.localeCompare(b)));
  });

  test('custom catalogue machines at the gym are offered too', () => {
    const custom = { id: 'odd-row', name: 'Odd Row', category: 'back', kind: 'machine', builtIn: false };
    const alts = swapAlternatives(entry('lat-pulldown'), [...BUILT_IN_CATALOG, custom], [ge('o', 'odd-row')]);
    expect(alts[0].id).toBe('odd-row');
  });
});

describe('planProgress', () => {
  const plan = [
    { catalogId: 'leg-press', sets: 3, reps: 10 },
    { catalogId: 'lat-pulldown', sets: 2, reps: 12 },
  ];

  test('counts sets per exercise on any machine and ticks at the target', () => {
    const sets = [
      set({ catalogId: 'leg-press', gymExerciseId: 'a' }),
      set({ catalogId: 'leg-press', gymExerciseId: 'b' }),
      set({ catalogId: 'lat-pulldown' }),
      set({ catalogId: 'lat-pulldown' }),
      set({ catalogId: 'lat-pulldown' }),
      set({ catalogId: 'dumbbell-curl' }),
    ];
    expect(planProgress(plan, sets)).toEqual([
      { done: 2, ticked: false },
      { done: 3, ticked: true },
    ]);
    expect(planProgress(plan, [])).toEqual([
      { done: 0, ticked: false },
      { done: 0, ticked: false },
    ]);
  });

  test('an exercise planned twice fills the first item first; the last takes the rest', () => {
    const twice = [
      { catalogId: 'leg-press', sets: 2, reps: 10 },
      { catalogId: 'pull-up', sets: 1, reps: 5 },
      { catalogId: 'leg-press', sets: 2, reps: 15 },
    ];
    const sets = [1, 2, 3, 4, 5].map(() => set({ catalogId: 'leg-press' }));
    expect(planProgress(twice, sets)).toEqual([
      { done: 2, ticked: true },
      { done: 0, ticked: false },
      { done: 3, ticked: true },
    ]);
    expect(planItemFor(twice, 'leg-press', sets.slice(0, 1))).toBe(twice[0]);
    expect(planItemFor(twice, 'leg-press', sets.slice(0, 2))).toBe(twice[2]);
  });

  test('planItemFor: null without a plan or when the exercise is not planned', () => {
    expect(planItemFor(undefined, 'leg-press')).toBeNull();
    expect(planItemFor(plan, 'dumbbell-curl')).toBeNull();
    expect(planItemFor(plan, 'lat-pulldown')).toBe(plan[1]);
  });
});

describe('session → program', () => {
  test('median', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([12, 8, 10])).toBe(10);
    expect(median([8, 12, 10, 9])).toBe(9.5);
  });

  test('exercises in the order first logged, sets counted, median reps rounded', () => {
    const sets = [
      set({ catalogId: 'lat-pulldown', reps: 12, completedAt: 10 }),
      set({ catalogId: 'leg-press', reps: 10, completedAt: 5, gymExerciseId: 'a' }),
      set({ catalogId: 'leg-press', reps: 8, completedAt: 20, gymExerciseId: 'b' }),
      set({ catalogId: 'lat-pulldown', reps: 9, completedAt: 30 }),
      set({ catalogId: 'band-row', reps: 15, unit: 'level', completedAt: 40 }),
      set({ catalogId: 'leg-press', reps: 7, completedAt: 50 }),
    ];
    expect(programFromSets(sets)).toEqual([
      { catalogId: 'leg-press', sets: 3, reps: 8 },
      { catalogId: 'lat-pulldown', sets: 2, reps: 11 }, // median 10.5 rounds up
      { catalogId: 'band-row', sets: 1, reps: 15 },
    ]);
    expect(programFromSets([])).toEqual([]);
  });

  test('targets are clamped to the steppers’ range', () => {
    expect(clampItem({ catalogId: 'x', sets: 0, reps: 99 })).toEqual({ catalogId: 'x', sets: 1, reps: 50 });
    expect(clampItem({ catalogId: 'x', sets: 30, reps: Number.NaN })).toEqual({ catalogId: 'x', sets: 20, reps: 1 });
    const many = Array.from({ length: 25 }, (_, i) => set({ catalogId: 'pull-up', reps: 0, completedAt: i }));
    expect(programFromSets(many)).toEqual([{ catalogId: 'pull-up', sets: 20, reps: 1 }]);
  });
});

test('formatTarget', () => {
  expect(formatTarget({ sets: 3, reps: 10 })).toBe('3 × 10');
});

describe('availabilityAt with several entries for one exercise', () => {
  test('a hidden entry does not hide a visible replacement', () => {
    const mine = [ge('old', 'chest-press', { hidden: true }), ge('new', 'chest-press')];
    expect(availabilityAt(entry('chest-press'), mine)).toMatchObject({ status: 'available', key: 'new' });
  });
  test('several visible entries need a choice, and last-used resolves it', () => {
    const mine = [ge('old', 'chest-press', { hidden: true }), ge('a', 'chest-press'), ge('b', 'chest-press')];
    expect(availabilityAt(entry('chest-press'), mine).status).toBe('choose');
    const sets = [set({ catalogId: 'chest-press', gymExerciseId: 'b' })];
    expect(resolveAt(entry('chest-press'), mine, sets, 'g')).toMatchObject({ status: 'available', key: 'b' });
  });
  test('free exercises: no entry is available, only hidden entries are missing, one visible is used', () => {
    const free = BUILT_IN_CATALOG.find((e) => e.kind === 'free' && e.defaultLoading);
    expect(availabilityAt(free, []).key).toBe('c:' + free.id);
    expect(availabilityAt(free, [ge('h', free.id, { hidden: true })]).status).toBe('missing');
    expect(availabilityAt(free, [ge('h', free.id, { hidden: true }), ge('v', free.id)])).toMatchObject({
      status: 'available',
      key: 'v',
    });
  });
});
