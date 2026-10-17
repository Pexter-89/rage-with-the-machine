import { beforeEach, describe, expect, test, vi } from 'vitest';
import { db, resetDb } from './db';
import { parseMachineFile } from '../domain/importMachine';
import { getCatalog } from './catalogRepo';
import {
  GymHasSessionsError,
  addGym,
  availableExercises,
  deleteGym,
  deleteGymExercise,
  importMachines,
  listGymMachines,
  machinesAlreadyAtGym,
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

describe('importMachines', () => {
  const machine = (catalogId: string, label: string) => ({ catalogId, label, notes: 'n', loading: plate });
  const custom = { id: 'hip-thing', name: 'Hip Thing', category: 'legs', kind: 'machine', builtIn: false } as const;

  test('adds custom entry and gym exercises atomically', async () => {
    const gym = await addGym('G');
    const out = await importMachines(gym.id, {
      ok: true,
      newExercises: [custom],
      machines: [machine('hip-thing', 'A'), machine('leg-press', 'B')],
    });
    expect(out).toHaveLength(2);
    expect((await getCatalog()).some((e) => e.id === 'hip-thing')).toBe(true);
    const mine = await db.gymExercises.where('gymId').equals(gym.id).toArray();
    expect(mine.map((m) => m.label).sort()).toEqual(['A', 'B']);
    expect(mine.every((m) => !m.hidden)).toBe(true);
  });

  test('re-importing the same file at a second gym creates no duplicate catalogue entry', async () => {
    const text = JSON.stringify({
      format: 'rwtm-machine',
      version: 1,
      machines: [
        {
          exercise: 'hip-thing',
          newExercise: { id: 'hip-thing', name: 'Hip Thing', category: 'legs', kind: 'machine' },
          loading: { type: 'plate', base: 10, step: 5 },
        },
      ],
    });
    const g1 = await addGym('G1');
    const g2 = await addGym('G2');
    for (const g of [g1, g2]) {
      const parsed = parseMachineFile(text, await getCatalog());
      if (!parsed.ok) throw new Error(parsed.error);
      await importMachines(g.id, parsed);
    }
    expect(await db.customCatalog.count()).toBe(1);
    expect(await db.gymExercises.count()).toBe(2);
  });

  test('machines the gym already has (same exercise, label and loading) are skipped; only created ones return', async () => {
    const gym = await addGym('G');
    const first = await importMachines(gym.id, { ok: true, newExercises: [], machines: [machine('leg-press', 'A')] });
    const parsed = {
      ok: true as const,
      newExercises: [],
      machines: [
        machine('leg-press', 'A'), // duplicate
        { ...machine('leg-press', 'A'), loading: { type: 'plate' as const, base: 70, step: 2.5 } }, // other loading
        machine('leg-press', 'B'), // other label
        machine('hack-squat', 'A'), // other exercise
      ],
    };
    expect(await machinesAlreadyAtGym(gym.id, parsed.machines)).toEqual([true, false, false, false]);
    const out = await importMachines(gym.id, parsed);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.id)).not.toContain(first[0].id);
    expect(await db.gymExercises.where('gymId').equals(gym.id).count()).toBe(4);
  });

  test('re-importing the same file at the same gym creates nothing, even with a stale parse', async () => {
    const gym = await addGym('G');
    // Parsed before either import ran, so it still declares the custom entry as new (a double tap / race).
    const parsed = { ok: true as const, newExercises: [custom], machines: [machine('hip-thing', 'A')] };
    expect(await importMachines(gym.id, parsed)).toHaveLength(1);
    expect(await importMachines(gym.id, parsed)).toEqual([]);
    expect(await db.gymExercises.count()).toBe(1);
    expect(await db.customCatalog.count()).toBe(1);
  });

  test('a hidden copy at the gym also counts as already there; other gyms do not', async () => {
    const gym = await addGym('G');
    const other = await addGym('O');
    await saveGymExercise({ gymId: gym.id, catalogId: 'leg-press', label: 'A', notes: '', loading: plate, hidden: true });
    expect(await machinesAlreadyAtGym(gym.id, [machine('leg-press', 'A')])).toEqual([true]);
    expect(await machinesAlreadyAtGym(other.id, [machine('leg-press', 'A')])).toEqual([false]);
  });

  test('failure adds nothing', async () => {
    const gym = await addGym('G');
    // the second custom entry collides with a built-in id, so addCustomEntries throws
    await expect(
      importMachines(gym.id, {
        ok: true,
        newExercises: [custom, { ...custom, id: 'leg-press' }],
        machines: [machine('hip-thing', 'A'), machine('leg-press', 'B')],
      }),
    ).rejects.toThrow();
    expect(await db.customCatalog.count()).toBe(0);
    expect(await db.gymExercises.count()).toBe(0);
  });

  test('failure while saving a gym exercise rolls back custom entries and earlier saves', async () => {
    const gym = await addGym('G');
    const realPut = db.gymExercises.put.bind(db.gymExercises);
    let calls = 0;
    const spy = vi.spyOn(db.gymExercises, 'put').mockImplementation(((...args: Parameters<typeof realPut>) => {
      if (++calls === 2) return Promise.reject(new Error('boom'));
      return realPut(...args);
    }) as typeof realPut);
    await expect(
      importMachines(gym.id, {
        ok: true,
        newExercises: [custom],
        machines: [machine('hip-thing', 'A'), machine('leg-press', 'B')],
      }),
    ).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await db.customCatalog.count()).toBe(0);
    expect(await db.gymExercises.count()).toBe(0);
  });
});
