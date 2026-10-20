import { beforeEach, describe, expect, test } from 'vitest';
import { db, resetDb } from './db';
import { buildCsvRows, exportBackup, restoreBackup, validateBackup } from './backup';
import { updateSettings, getSettings } from './settingsRepo';
import { setsToCsv } from '../domain/csv';

beforeEach(resetDb);

const T = 1_800_000_000_000;

async function seed() {
  await db.gyms.add({ id: 'g1', name: 'Home', order: 0, archived: false });
  await db.customCatalog.add({ id: 'c1', name: 'Odd Machine', category: 'back', kind: 'machine', builtIn: false });
  await db.gymExercises.add({
    id: 'ge1', gymId: 'g1', catalogId: 'leg-press', label: 'Technogym', notes: '',
    loading: { type: 'plate', base: 62, step: 2.5 }, hidden: false,
  });
  await db.sessions.add({ id: 's1', gymId: 'g1', startedAt: T, endedAt: T + 3600_000, lastActivityAt: T + 3600_000, bodyweight: 82.5 });
  await db.sets.bulkAdd([
    { id: 'x1', sessionId: 's1', gymId: 'g1', catalogId: 'leg-press', gymExerciseId: 'ge1', order: 1, weight: 92, reps: 10, baseWeight: 62, unit: 'kg', completedAt: T + 1000 },
    { id: 'x2', sessionId: 's1', gymId: 'g1', catalogId: 'pull-up', gymExerciseId: null, order: 1, weight: 5, reps: 8, baseWeight: null, unit: 'kg', completedAt: T + 500 },
  ]);
  await updateSettings({ theme: 'dark', autoCloseMinutes: 45 });
}

describe('backup', () => {
  test('backup round-trips losslessly', async () => {
    await seed();
    const b = await exportBackup(T);
    expect(b.format).toBe('rwtm-backup');
    expect(b.version).toBe(1);
    expect(b.exportedAt).toBe(T);
    await resetDb();
    await restoreBackup(b);
    expect(await exportBackup(T)).toEqual(b);
    expect((await getSettings()).theme).toBe('dark');
  });

  test('exportBackup does not touch lastBackupAt', async () => {
    await seed();
    await exportBackup(T);
    expect((await getSettings()).lastBackupAt).toBeNull();
  });

  test('validateBackup rejects wrong format, wrong version, missing tables', async () => {
    await seed();
    const good = await exportBackup(T);
    expect(validateBackup(JSON.parse(JSON.stringify(good)))).toEqual({ ok: true, file: good });
    for (const bad of [
      null, 'x', [], {},
      { ...good, format: 'nope' },
      { ...good, version: 2 },
      { ...good, data: undefined },
      { ...good, data: { ...good.data, sets: undefined } },
      { ...good, data: { ...good.data, gyms: {} } },
      { ...good, data: { ...good.data, settings: [] } },
      { ...good, data: { ...good.data, settings: undefined } },
    ]) {
      const v = validateBackup(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).not.toContain('\n');
    }
  });

  test('invalid backup leaves data intact', async () => {
    await seed();
    const v = validateBackup({ format: 'nope' });
    expect(v.ok).toBe(false);
    const before = await exportBackup(T);
    const dup = { ...before, data: { ...before.data, gyms: [], sets: [before.data.sets[0], before.data.sets[0]] } };
    await expect(restoreBackup(dup)).rejects.toBeTruthy();
    expect(await exportBackup(T)).toEqual(before);
  });
});

describe('buildCsvRows', () => {
  test('joins catalogue, gym and machine; ordered by completedAt', async () => {
    await seed();
    const rows = await buildCsvRows();
    expect(rows.map((r) => r.exercise)).toEqual(['Pull-Up', 'Leg Press']);
    expect(rows[1]).toMatchObject({
      gym: 'Home', category: 'Legs', machine: 'Technogym', setNo: 1, weight: 92, reps: 10,
      unit: 'kg', baseWeight: 62, kind: 'machine', bodyweight: 82.5,
    });
    expect(rows[0]).toMatchObject({ machine: '', kind: 'bodyweight', category: 'Back' });
    expect(setsToCsv(rows).split('\r\n')[1]).toContain(',Pull-Up,');
  });
});
