import Dexie from 'dexie';
import { RwtmDB, db, resetDb } from '../../app/js/db/db.js';
import { addGym } from '../../app/js/db/gymRepo.js';
import {
  addProgram,
  deleteProgram,
  getProgram,
  listPrograms,
  moveProgram,
  saveSessionAsProgram,
  startProgramSession,
  swapPlanItem,
  updateProgram,
} from '../../app/js/db/programRepo.js';
import { addSet, finishSession, getOpenSession, startSession } from '../../app/js/db/sessionRepo.js';

beforeEach(resetDb);

const T = 1_800_000_000_000;
const ITEMS = [
  { catalogId: 'leg-press', sets: 3, reps: 10 },
  { catalogId: 'lat-pulldown', sets: 3, reps: 12 },
];
const item = (catalogId, gymExerciseId = null) => ({
  catalogId,
  gymExerciseId,
  loading: { type: 'stack', weights: [10, 20] },
});

test('addProgram stores the documented shape, appended in order, with targets clamped and the name trimmed', async () => {
  const a = await addProgram({ name: '  Upper  ', items: ITEMS }, T);
  const b = await addProgram({ name: '', items: [{ catalogId: 'pull-up', sets: 0, reps: 80 }] }, T + 1);
  expect(await getProgram(a.id)).toEqual({
    id: a.id,
    name: 'Upper',
    order: 0,
    archived: false,
    items: ITEMS,
    createdAt: T,
    updatedAt: T,
  });
  expect(b).toMatchObject({ name: 'Program', order: 1, items: [{ catalogId: 'pull-up', sets: 1, reps: 50 }] });
  expect((await listPrograms()).map((p) => p.id)).toEqual([a.id, b.id]);
});

test('listPrograms leaves out archived programs', async () => {
  const a = await addProgram({ name: 'A', items: ITEMS }, T);
  await addProgram({ name: 'B', items: ITEMS }, T);
  await db.programs.update(a.id, { archived: true });
  expect((await listPrograms()).map((p) => p.name)).toEqual(['B']);
});

test('updateProgram renames, replaces items and stamps updatedAt', async () => {
  const p = await addProgram({ name: 'A', items: ITEMS }, T);
  await updateProgram(p.id, { name: 'B', items: [ITEMS[1]] }, T + 5);
  expect(await getProgram(p.id)).toMatchObject({ name: 'B', items: [ITEMS[1]], createdAt: T, updatedAt: T + 5 });
});

test('moveProgram swaps with the neighbour and is a no-op at the ends; deleteProgram removes it', async () => {
  const a = await addProgram({ name: 'A', items: ITEMS }, T);
  const b = await addProgram({ name: 'B', items: ITEMS }, T);
  const c = await addProgram({ name: 'C', items: ITEMS }, T);
  await moveProgram(c.id, -1);
  expect((await listPrograms()).map((p) => p.name)).toEqual(['A', 'C', 'B']);
  await moveProgram(a.id, -1);
  await moveProgram(b.id, 1);
  expect((await listPrograms()).map((p) => p.name)).toEqual(['A', 'C', 'B']);
  await deleteProgram(c.id);
  expect((await listPrograms()).map((p) => p.name)).toEqual(['A', 'B']);
});

describe('startProgramSession', () => {
  test('starts a session with programId and a snapshot of the items; editing the program later keeps the plan', async () => {
    const g = await addGym('Kamppi');
    const p = await addProgram({ name: 'A', items: ITEMS }, T);
    const s = await startProgramSession(g.id, p.id, T, 90);
    expect(await db.sessions.get(s.id)).toMatchObject({ gymId: g.id, programId: p.id, plan: ITEMS, endedAt: null });
    await updateProgram(p.id, { name: 'A', items: [ITEMS[0]] }, T + 1);
    expect((await db.sessions.get(s.id))?.plan).toEqual(ITEMS);
    await deleteProgram(p.id);
    expect((await db.sessions.get(s.id))?.plan).toEqual(ITEMS);
  });

  test('an open session at the same gym gets the plan; one at another gym is finished', async () => {
    const g = await addGym('Kamppi');
    const other = await addGym('Otaniemi');
    const p = await addProgram({ name: 'A', items: ITEMS }, T);
    const here = await startSession(g.id, T);
    expect((await startProgramSession(g.id, p.id, T + 60_000, 90)).id).toBe(here.id);
    expect((await db.sessions.get(here.id))?.plan).toEqual(ITEMS);

    await addSet(here.id, item('leg-press'), 10, 10, T + 120_000);
    const s = await startProgramSession(other.id, p.id, T + 180_000, 90);
    expect(s.id).not.toBe(here.id);
    expect((await db.sessions.get(here.id))?.endedAt).toBe(T + 180_000);
    expect((await getOpenSession())?.id).toBe(s.id);
  });

  test('a timed-out open session at the same gym is closed, not resumed', async () => {
    const g = await addGym('Kamppi');
    const p = await addProgram({ name: 'A', items: ITEMS }, T);
    const old = await startSession(g.id, T);
    await addSet(old.id, item('leg-press'), 10, 10, T);
    const s = await startProgramSession(g.id, p.id, T + 3 * 3600_000, 90);
    expect(s.id).not.toBe(old.id);
    expect((await db.sessions.get(old.id))?.endedAt).toBe(T);
  });

  test('a program that no longer exists starts nothing', async () => {
    const g = await addGym('Kamppi');
    await expect(startProgramSession(g.id, 'gone', T, 90)).rejects.toThrow('no longer exists');
    expect(await db.sessions.count()).toBe(0);
  });
});

test('swapPlanItem replaces one plan item’s exercise, keeps sets × reps, and never touches the program', async () => {
  const g = await addGym('Kamppi');
  const p = await addProgram({ name: 'A', items: ITEMS }, T);
  const s = await startProgramSession(g.id, p.id, T, 90);
  await swapPlanItem(s.id, 1, 'pull-up');
  expect((await db.sessions.get(s.id))?.plan).toEqual([ITEMS[0], { catalogId: 'pull-up', sets: 3, reps: 12 }]);
  expect((await getProgram(p.id))?.items).toEqual(ITEMS);
  await swapPlanItem(s.id, 7, 'x'); // out of range: no-op
  await swapPlanItem('nope', 0, 'x');
  expect((await db.sessions.get(s.id))?.plan).toHaveLength(2);
});

test('saveSessionAsProgram derives items from an ongoing or completed session', async () => {
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, T);
  await addSet(s.id, item('lat-pulldown', 'ge1'), 40, 12, T + 1);
  await addSet(s.id, item('leg-press'), 100, 10, T + 2);
  await addSet(s.id, item('lat-pulldown', 'ge2'), 40, 10, T + 3);
  const ongoing = await saveSessionAsProgram(s.id, 'Mine', T + 10);
  expect(ongoing.items).toEqual([
    { catalogId: 'lat-pulldown', sets: 2, reps: 11 },
    { catalogId: 'leg-press', sets: 1, reps: 10 },
  ]);
  await finishSession(s.id, T + 20);
  const done = await saveSessionAsProgram(s.id, 'Again', T + 30);
  expect(done.items).toEqual(ongoing.items);
  expect((await listPrograms()).map((p) => p.name)).toEqual(['Mine', 'Again']);

  const empty = await startSession(g.id, T + 40);
  await expect(saveSessionAsProgram(empty.id, 'Empty', T)).rejects.toThrow('no sets');
  expect(await db.programs.count()).toBe(2);
});

test('schema version 2 adds programs to a version 1 database and keeps its data', async () => {
  db.close();
  await db.delete();
  const v1 = new Dexie('rwtm');
  v1.version(1).stores({
    gyms: 'id,order',
    customCatalog: 'id',
    gymExercises: 'id,gymId,catalogId',
    sessions: 'id,gymId,startedAt,endedAt',
    sets: 'id,sessionId,catalogId,gymId,gymExerciseId,completedAt',
    kv: 'key',
  });
  await v1.open();
  await v1.table('gyms').add({ id: 'g1', name: 'Old', order: 0, archived: false });
  await v1.table('sessions').add({ id: 's1', gymId: 'g1', startedAt: T, endedAt: T + 1, lastActivityAt: T });
  v1.close();

  const upgraded = new RwtmDB();
  await upgraded.open();
  expect(upgraded.verno).toBe(2);
  expect(await upgraded.gyms.get('g1')).toMatchObject({ name: 'Old' });
  expect((await upgraded.sessions.get('s1'))?.plan).toBeUndefined();
  expect(await upgraded.programs.count()).toBe(0);
  upgraded.close();
});
