import { beforeEach, describe, expect, test } from 'vitest';
import { db, resetDb } from './db';
import { getCatalog } from './catalogRepo';
import {
  GymHasSessionsError,
  addGym,
  availableExercises,
  deleteGym,
  deleteGymExercise,
  listGymMachines,
  listGyms,
  moveGym,
  renameGym,
  resolveItem,
  saveGymExercise,
  setGymArchived,
} from './gymRepo';

beforeEach(resetDb);

const plate = { type: 'plate', base: 62, step: 2.5 } as const;

describe('gyms', () => {
  test('addGym orders sequentially; listGyms hides archived by default', async () => {
    const a = await addGym('A');
    const b = await addGym('B');
    const c = await addGym('C');
    expect([a.order, b.order, c.order]).toEqual([0, 1, 2]);
    await setGymArchived(b.id, true);
    expect((await listGyms()).map((g) => g.name)).toEqual(['A', 'C']);
    expect((await listGyms({ includeArchived: true })).map((g) => g.name)).toEqual(['A', 'B', 'C']);
  });

  test('renameGym renames', async () => {
    const a = await addGym('A');
    await renameGym(a.id, 'Z');
    expect((await listGyms())[0].name).toBe('Z');
  });

  test('moveGym swaps order with neighbour; no-op at ends', async () => {
    const a = await addGym('A');
    const b = await addGym('B');
    const c = await addGym('C');
    await moveGym(b.id, -1);
    expect((await listGyms()).map((g) => g.name)).toEqual(['B', 'A', 'C']);
    await moveGym(b.id, -1);
    expect((await listGyms()).map((g) => g.name)).toEqual(['B', 'A', 'C']);
    await moveGym(c.id, 1);
    expect((await listGyms()).map((g) => g.name)).toEqual(['B', 'A', 'C']);
    await moveGym(a.id, 1);
    expect((await listGyms()).map((g) => g.name)).toEqual(['B', 'C', 'A']);
  });

  test('moveGym skips archived gyms when finding the neighbour', async () => {
    await addGym('A');
    const b = await addGym('B');
    const c = await addGym('C');
    await setGymArchived(b.id, true);
    await moveGym(c.id, -1);
    expect((await listGyms()).map((g) => g.name)).toEqual(['C', 'A']);
  });

  test('deleteGym throws GymHasSessionsError when a session exists, else removes gym and its gymExercises', async () => {
    const g = await addGym('G');
    await saveGymExercise({ gymId: g.id, catalogId: 'leg-press', label: '', notes: '', loading: plate, hidden: false });
    await db.sessions.add({ id: 's1', gymId: g.id, startedAt: 1, endedAt: null, lastActivityAt: 1 });
    await expect(deleteGym(g.id)).rejects.toBeInstanceOf(GymHasSessionsError);
    expect(await db.gyms.count()).toBe(1);
    expect(await db.gymExercises.count()).toBe(1);
    await db.sessions.clear();
    await deleteGym(g.id);
    expect(await db.gyms.count()).toBe(0);
    expect(await db.gymExercises.count()).toBe(0);
  });
});

describe('gym exercises and picker', () => {
  test('availableExercises: machines of this gym + every free/bodyweight catalogue entry with defaultLoading', async () => {
    const g = await addGym('Kamppi');
    const cat = await getCatalog();
    await saveGymExercise({ gymId: g.id, catalogId: 'leg-press', label: 'Technogym', notes: '', loading: plate, hidden: false });
    const items = await availableExercises(g.id, cat);
    expect(items.find((i) => i.catalogId === 'leg-press')!.loading).toEqual(plate);
    expect(items.some((i) => i.catalogId === 'lat-pulldown')).toBe(false);
    expect(items.find((i) => i.catalogId === 'dumbbell-bench-press')!.key).toBe('c:dumbbell-bench-press');
  });

  test('gym override of a free exercise replaces default loading; hidden override removes it', async () => {
    const g = await addGym('G');
    const cat = await getCatalog();
    const ge = await saveGymExercise({
      gymId: g.id, catalogId: 'dumbbell-bench-press', label: '', notes: '',
      loading: { type: 'free', start: 2, step: 2, max: 40 }, hidden: false,
    });
    let items = await availableExercises(g.id, cat);
    const matches = items.filter((i) => i.catalogId === 'dumbbell-bench-press');
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe(ge.id);
    expect(matches[0].loading).toEqual({ type: 'free', start: 2, step: 2, max: 40 });
    await saveGymExercise({ ...ge, hidden: true });
    items = await availableExercises(g.id, cat);
    expect(items.some((i) => i.catalogId === 'dumbbell-bench-press')).toBe(false);
  });

  test('hidden machines are excluded from picker but listed by listGymMachines', async () => {
    const g = await addGym('G');
    const cat = await getCatalog();
    await saveGymExercise({ gymId: g.id, catalogId: 'leg-press', label: '', notes: '', loading: plate, hidden: true });
    expect((await availableExercises(g.id, cat)).some((i) => i.catalogId === 'leg-press')).toBe(false);
    expect(await listGymMachines(g.id)).toHaveLength(1);
  });

  test('two machines mapped to same catalogue id both appear, distinguished by label', async () => {
    const g = await addGym('G');
    const cat = await getCatalog();
    await saveGymExercise({ gymId: g.id, catalogId: 'leg-press', label: 'B', notes: '', loading: plate, hidden: false });
    await saveGymExercise({ gymId: g.id, catalogId: 'leg-press', label: 'A', notes: '', loading: plate, hidden: false });
    const items = (await availableExercises(g.id, cat)).filter((i) => i.catalogId === 'leg-press');
    expect(items.map((i) => i.label)).toEqual(['A', 'B']);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
    expect((await listGymMachines(g.id)).map((m) => m.label)).toEqual(['A', 'B']);
  });

  test('listGymMachines excludes free exercise overrides and other gyms', async () => {
    const g = await addGym('G');
    const h = await addGym('H');
    await saveGymExercise({ gymId: g.id, catalogId: 'dumbbell-bench-press', label: '', notes: '', loading: { type: 'free', start: 1, step: 1, max: 5 }, hidden: false });
    await saveGymExercise({ gymId: h.id, catalogId: 'leg-press', label: '', notes: '', loading: plate, hidden: false });
    expect(await listGymMachines(g.id)).toEqual([]);
  });

  test('picker items are ordered by category', async () => {
    const g = await addGym('G');
    const cat = await getCatalog();
    const items = await availableExercises(g.id, cat);
    const order = ['legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'fullbody'];
    const idx = items.map((i) => order.indexOf(i.category));
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
  });

  test('picker loadings are clones: mutating them never changes the catalogue', async () => {
    const g = await addGym('G');
    const items = await availableExercises(g.id, await getCatalog());
    const it = items.find((i) => i.catalogId === 'dumbbell-bench-press')!;
    (it.loading as { start: number }).start = 999;
    const again = await availableExercises(g.id, await getCatalog());
    expect((again.find((i) => i.catalogId === 'dumbbell-bench-press')!.loading as { start: number }).start).toBe(1);
  });

  test('resolveItem round-trips keys from availableExercises', async () => {
    const g = await addGym('G');
    const cat = await getCatalog();
    await saveGymExercise({ gymId: g.id, catalogId: 'leg-press', label: 'X', notes: '', loading: plate, hidden: false });
    for (const item of await availableExercises(g.id, cat)) {
      expect(await resolveItem(g.id, item.key, cat)).toEqual(item);
    }
    expect(await resolveItem(g.id, 'c:nope', cat)).toBeNull();
    expect(await resolveItem(g.id, 'missing-id', cat)).toBeNull();
  });

  test('deleteGymExercise removes it', async () => {
    const g = await addGym('G');
    const ge = await saveGymExercise({ gymId: g.id, catalogId: 'leg-press', label: '', notes: '', loading: plate, hidden: false });
    await deleteGymExercise(ge.id);
    expect(await listGymMachines(g.id)).toEqual([]);
  });
});
