import { beforeEach, describe, expect, test } from 'vitest';
import { db, resetDb } from '../../app/js/db/db.js';
import { buildCsvRows, exportBackup, restoreBackup, validateBackup } from '../../app/js/db/backup.js';
import { updateSettings, getSettings } from '../../app/js/db/settingsRepo.js';
import { setsToCsv } from '../../app/js/domain/csv.js';

beforeEach(resetDb);

const T = 1_800_000_000_000;

async function seed() {
  await db.gyms.add({ id: 'g1', name: 'Home', order: 0, archived: false });
  await db.customCatalog.add({ id: 'c1', name: 'Odd Machine', category: 'back', kind: 'machine', builtIn: false });
  await db.gymExercises.add({
    id: 'ge1',
    gymId: 'g1',
    catalogId: 'leg-press',
    label: 'Technogym',
    notes: '',
    loading: { type: 'plate', base: 62, step: 2.5 },
    hidden: false,
  });
  await db.sessions.add({
    id: 's1',
    gymId: 'g1',
    startedAt: T,
    endedAt: T + 3600_000,
    lastActivityAt: T + 3600_000,
    bodyweight: 82.5,
  });
  await db.sets.bulkAdd([
    {
      id: 'x1',
      sessionId: 's1',
      gymId: 'g1',
      catalogId: 'leg-press',
      gymExerciseId: 'ge1',
      order: 1,
      weight: 92,
      reps: 10,
      baseWeight: 62,
      unit: 'kg',
      completedAt: T + 1000,
    },
    {
      id: 'x2',
      sessionId: 's1',
      gymId: 'g1',
      catalogId: 'pull-up',
      gymExerciseId: null,
      order: 1,
      weight: 5,
      reps: 8,
      baseWeight: null,
      unit: 'kg',
      completedAt: T + 500,
    },
  ]);
  await updateSettings({ theme: 'dark', autoCloseMinutes: 45 });
}

const PROGRAM = {
  id: 'p1',
  name: 'Legs',
  order: 0,
  archived: false,
  items: [
    { catalogId: 'leg-press', sets: 3, reps: 10 },
    { catalogId: 'pull-up', sets: 3, reps: 8 },
  ],
  createdAt: T,
  updatedAt: T,
};

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

  test('programs and session plans round-trip', async () => {
    await seed();
    await db.programs.add(PROGRAM);
    await db.sessions.update('s1', { programId: 'p1', plan: PROGRAM.items });
    const b = await exportBackup(T);
    expect(b.data.programs).toEqual([PROGRAM]);
    expect(b.version).toBe(1);
    await resetDb();
    await restoreBackup(JSON.parse(JSON.stringify(b)));
    expect(await db.programs.toArray()).toEqual([PROGRAM]);
    expect((await db.sessions.get('s1'))?.plan).toEqual(PROGRAM.items);
    expect(await exportBackup(T)).toEqual(b);
  });

  test('a backup from before programs (no "programs" list) is valid and restores with no programs', async () => {
    await seed();
    const b = await exportBackup(T);
    const old = { ...b, data: { ...b.data } };
    delete old.data.programs;
    expect(validateBackup(old)).toEqual({ ok: true, file: old });
    await db.programs.add(PROGRAM); // like every other table, the restore replaces what is there
    await restoreBackup(old);
    expect(await db.programs.count()).toBe(0);
    expect(await db.gyms.count()).toBe(1);
    expect((await exportBackup(T)).data.programs).toEqual([]);
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
      null,
      'x',
      [],
      {},
      { ...good, format: 'nope' },
      { ...good, version: 2 },
      { ...good, data: undefined },
      { ...good, data: { ...good.data, sets: undefined } },
      { ...good, data: { ...good.data, gyms: {} } },
      { ...good, data: { ...good.data, settings: [] } },
      { ...good, data: { ...good.data, settings: undefined } },
      { ...good, data: { ...good.data, programs: {} } },
      { ...good, data: { ...good.data, programs: null } },
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
      gym: 'Home',
      category: 'Legs',
      machine: 'Technogym',
      setNo: 1,
      weight: 92,
      reps: 10,
      unit: 'kg',
      baseWeight: 62,
      kind: 'machine',
      bodyweight: 82.5,
    });
    expect(rows[0]).toMatchObject({ machine: '', kind: 'bodyweight', category: 'Back' });
    expect(setsToCsv(rows).split('\r\n')[1]).toContain(',Pull-Up,');
  });
});
