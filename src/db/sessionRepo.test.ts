import { beforeEach, describe, expect, test } from 'vitest';
import { RwtmDB, db, resetDb } from './db';
import { addGym, availableExercises, saveGymExercise } from './gymRepo';
import { getCatalog } from './catalogRepo';
import {
  SessionEndedError,
  addSet,
  clearHistory,
  closeStaleSessions,
  deleteHistorySets,
  deleteExerciseSets,
  deleteSession,
  deleteSet,
  finishSession,
  getLastTime,
  getOpenSession,
  prefill,
  recomputePlateHistory,
  sessionExercises,
  setsForItem,
  startOrResumeSession,
  startSession,
  updateSet,
} from './sessionRepo';
import type { Gym, PickerItem, SetEntry } from '../domain/types';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

let g: Gym;
let item: PickerItem;

async function makeItem(gymId: string, loading: PickerItem['loading'], label = 'Press'): Promise<PickerItem> {
  const catalog = await getCatalog();
  const entry = catalog.find((e) => e.kind === 'machine')!;
  const ge = await saveGymExercise({ gymId, catalogId: entry.id, label, notes: '', loading, hidden: false });
  const items = await availableExercises(gymId, catalog);
  return items.find((i) => i.key === ge.id)!;
}

async function freeItem(gymId: string): Promise<PickerItem> {
  const items = await availableExercises(gymId, await getCatalog());
  return items.find((i) => i.gymExerciseId === null && i.loading.type === 'free')!;
}

beforeEach(async () => {
  await resetDb();
  g = await addGym('Home');
  item = await makeItem(g.id, { type: 'plate', base: 62, step: 2.5 });
});

describe('durability', () => {
  test('addSet persists across a fresh DB connection', async () => {
    const s = await startSession(g.id, T0);
    const set = await addSet(s.id, item, 62, 10, T0 + 1000);
    db.close();
    const fresh = new RwtmDB();
    try {
      expect(await fresh.sets.get(set.id)).toEqual(set);
      const sess = await fresh.sessions.get(s.id);
      expect(sess!.endedAt).toBeNull();
      expect(sess!.lastActivityAt).toBe(T0 + 1000);
    } finally {
      fresh.close();
      await resetDb();
    }
  });
});

describe('sessions', () => {
  test('getOpenSession returns the open session or null', async () => {
    expect(await getOpenSession()).toBeNull();
    const s = await startSession(g.id, T0);
    expect((await getOpenSession())!.id).toBe(s.id);
  });

  test('startSession while another is open finishes the previous one', async () => {
    const a = await startSession(g.id, T0);
    await addSet(a.id, item, 62, 10, T0 + 1000);
    const b = await startSession(g.id, T0 + 5000);
    expect((await db.sessions.get(a.id))!.endedAt).toBe(T0 + 5000);
    expect((await getOpenSession())!.id).toBe(b.id);
    expect(b).toMatchObject({ gymId: g.id, startedAt: T0 + 5000, endedAt: null, lastActivityAt: T0 + 5000 });
  });

  test('startSession deletes a previous open session that has no sets', async () => {
    const a = await startSession(g.id, T0);
    await startSession(g.id, T0 + 5000);
    expect(await db.sessions.get(a.id)).toBeUndefined();
  });

  test('finishSession sets endedAt; empty session is deleted; closed session is a no-op', async () => {
    const a = await startSession(g.id, T0);
    await addSet(a.id, item, 62, 10, T0 + 1000);
    await finishSession(a.id, T0 + 2000);
    expect((await db.sessions.get(a.id))!.endedAt).toBe(T0 + 2000);
    await finishSession(a.id, T0 + 9000);
    expect((await db.sessions.get(a.id))!.endedAt).toBe(T0 + 2000);

    const b = await startSession(g.id, T0 + 10_000);
    await finishSession(b.id, T0 + 11_000);
    expect(await db.sessions.get(b.id)).toBeUndefined();
  });
});

describe('startOrResumeSession', () => {
  test('the open session at the same gym is resumed, not split', async () => {
    const a = await startSession(g.id, T0);
    await addSet(a.id, item, 62, 10, T0 + 1000);
    const again = await startOrResumeSession(g.id, T0 + 5 * MIN, 30);
    expect(again.id).toBe(a.id);
    expect(await db.sessions.count()).toBe(1);
    expect((await db.sessions.get(a.id))!.endedAt).toBeNull();
  });

  test('another gym finishes the open session and starts a new one', async () => {
    const other = await addGym('Other');
    const a = await startSession(g.id, T0);
    await addSet(a.id, item, 62, 10, T0 + 1000);
    const b = await startOrResumeSession(other.id, T0 + 5 * MIN, 30);
    expect(b.id).not.toBe(a.id);
    expect(b.gymId).toBe(other.id);
    expect((await db.sessions.get(a.id))!.endedAt).toBe(T0 + 5 * MIN);
  });

  test('a timed-out session at the same gym is closed at its last activity and a new one starts', async () => {
    const a = await startSession(g.id, T0);
    await addSet(a.id, item, 62, 10, T0 + 1000);
    const b = await startOrResumeSession(g.id, T0 + 1000 + 31 * MIN, 30);
    expect(b.id).not.toBe(a.id);
    expect((await db.sessions.get(a.id))!.endedAt).toBe(T0 + 1000);
  });
});

describe('closeStaleSessions', () => {
  test('31 min idle: closed at lastActivityAt', async () => {
    const s = await startSession(g.id, T0);
    await addSet(s.id, item, 62, 10, T0 + 60_000);
    await closeStaleSessions(T0 + 60_000 + 31 * MIN, 30);
    expect((await db.sessions.get(s.id))!.endedAt).toBe(T0 + 60_000);
  });

  test('29 min idle: still open', async () => {
    const s = await startSession(g.id, T0);
    await addSet(s.id, item, 62, 10, T0 + 60_000);
    await closeStaleSessions(T0 + 60_000 + 29 * MIN, 30);
    expect((await db.sessions.get(s.id))!.endedAt).toBeNull();
  });

  test('stale empty session is deleted', async () => {
    const s = await startSession(g.id, T0);
    await closeStaleSessions(T0 + 31 * MIN, 30);
    expect(await db.sessions.get(s.id)).toBeUndefined();
  });

  test('does not touch already-closed sessions', async () => {
    const s = await startSession(g.id, T0);
    await addSet(s.id, item, 62, 10, T0 + 1000);
    await finishSession(s.id, T0 + 2000);
    await closeStaleSessions(T0 + 999 * MIN, 30);
    expect((await db.sessions.get(s.id))!.endedAt).toBe(T0 + 2000);
  });
});

describe('sets', () => {
  test('writes into an ended session throw SessionEndedError and change nothing', async () => {
    const s = await startSession(g.id, T0);
    const set = await addSet(s.id, item, 62, 10, T0 + 1000);
    await finishSession(s.id, T0 + 2000);
    await expect(addSet(s.id, item, 64, 8, T0 + 3000)).rejects.toBeInstanceOf(SessionEndedError);
    await expect(updateSet(set.id, { reps: 12 }, T0 + 3000)).rejects.toBeInstanceOf(SessionEndedError);
    await expect(deleteSet(set.id, T0 + 3000)).rejects.toBeInstanceOf(SessionEndedError);
    expect(await db.sets.where('sessionId').equals(s.id).toArray()).toEqual([set]);
    expect((await db.sessions.get(s.id))!).toMatchObject({ endedAt: T0 + 2000, lastActivityAt: T0 + 1000 });
  });

  test('addSet order, baseWeight snapshot for plate, bumps lastActivityAt', async () => {
    const s = await startSession(g.id, T0);
    const a = await addSet(s.id, item, 62, 10, T0 + 1000);
    const b = await addSet(s.id, item, 65, 8, T0 + 2000);
    expect(a).toMatchObject({
      sessionId: s.id,
      gymId: g.id,
      catalogId: item.catalogId,
      gymExerciseId: item.gymExerciseId,
      order: 1,
      weight: 62,
      reps: 10,
      baseWeight: 62,
      unit: 'kg',
      completedAt: T0 + 1000,
    });
    expect(b.order).toBe(2);
    expect((await db.sessions.get(s.id))!.lastActivityAt).toBe(T0 + 2000);
  });

  test('stack: baseWeight null, unit level when stack unit is level, else kg', async () => {
    const lvl = await makeItem(g.id, { type: 'stack', weights: [1, 2, 3], unit: 'level' }, 'Lvl');
    const kg = await makeItem(g.id, { type: 'stack', weights: [10, 20] }, 'Kg');
    const s = await startSession(g.id, T0);
    const a = await addSet(s.id, lvl, 3, 10, T0 + 1);
    const b = await addSet(s.id, kg, 20, 10, T0 + 2);
    expect(a).toMatchObject({ unit: 'level', baseWeight: null });
    expect(b).toMatchObject({ unit: 'kg', baseWeight: null });
  });

  test('free item: gymExerciseId null, unit kg, baseWeight null; order counts per item', async () => {
    const f = await freeItem(g.id);
    const s = await startSession(g.id, T0);
    await addSet(s.id, item, 62, 10, T0 + 1);
    const x = await addSet(s.id, f, 20, 5, T0 + 2);
    const y = await addSet(s.id, f, 20, 5, T0 + 3);
    expect(x).toMatchObject({ gymExerciseId: null, unit: 'kg', baseWeight: null, order: 1 });
    expect(y.order).toBe(2);
    expect((await setsForItem(s.id, f)).map((r) => r.id)).toEqual([x.id, y.id]);
    expect((await setsForItem(s.id, item)).length).toBe(1);
  });

  test('updateSet patches and bumps lastActivityAt; deleteSet removes and bumps', async () => {
    const s = await startSession(g.id, T0);
    const a = await addSet(s.id, item, 62, 10, T0 + 1000);
    await updateSet(a.id, { reps: 12 }, T0 + 2000);
    expect(await db.sets.get(a.id)).toMatchObject({ weight: 62, reps: 12 });
    expect((await db.sessions.get(s.id))!.lastActivityAt).toBe(T0 + 2000);
    await updateSet(a.id, { weight: 65 }, T0 + 3000);
    expect((await db.sets.get(a.id))!.weight).toBe(65);
    await deleteSet(a.id, T0 + 4000);
    expect(await db.sets.get(a.id)).toBeUndefined();
    expect((await db.sessions.get(s.id))!.lastActivityAt).toBe(T0 + 4000);
  });
});

describe('getLastTime', () => {
  test('prefers same gym even if another gym is more recent', async () => {
    const other = await addGym('Other');
    const otherItem = await makeItem(other.id, { type: 'plate', base: 62, step: 2.5 });
    const home = await startSession(g.id, T0);
    await addSet(home.id, item, 60, 10, T0 + 1000);
    await finishSession(home.id, T0 + 2000);
    const away = await startSession(other.id, T0 + 100_000);
    await addSet(away.id, otherItem, 70, 10, T0 + 101_000);
    await finishSession(away.id, T0 + 102_000);
    const cur = await startSession(g.id, T0 + 200_000);

    const last = await getLastTime(item.catalogId, g.id, cur.id);
    expect(last!.sessionId).toBe(home.id);
    expect(last!.gymId).toBe(g.id);
    expect(last!.date).toBe(T0);
    expect(last!.sets.map((x) => x.weight)).toEqual([60]);
  });

  test('falls back to other gym; excludes current session; null when none', async () => {
    const other = await addGym('Other');
    const otherItem = await makeItem(other.id, { type: 'plate', base: 62, step: 2.5 });
    const cur = await startSession(g.id, T0);
    await addSet(cur.id, item, 60, 10, T0 + 1000);
    expect(await getLastTime(item.catalogId, g.id, cur.id)).toBeNull();
    await finishSession(cur.id, T0 + 2000);

    const away = await startSession(other.id, T0 + 10_000);
    await addSet(away.id, otherItem, 70, 8, T0 + 11_000);
    await addSet(away.id, otherItem, 72, 6, T0 + 12_000);
    await finishSession(away.id, T0 + 13_000);
    const now = await startSession(other.id, T0 + 20_000);

    const sameGym = await getLastTime(item.catalogId, other.id, now.id);
    expect(sameGym!.sessionId).toBe(away.id);
    expect(sameGym!.sets.map((x) => x.order)).toEqual([1, 2]);

    const fallback = await getLastTime(item.catalogId, 'no-such-gym', now.id);
    expect(fallback!.sessionId).toBe(away.id);
  });

  test('includes open sessions other than the excluded one', async () => {
    const openOne = await startSession(g.id, T0);
    await addSet(openOne.id, item, 60, 10, T0 + 1000);
    expect((await getLastTime(item.catalogId, g.id, 'other-id'))!.sessionId).toBe(openOne.id);
    expect(await getLastTime(item.catalogId, g.id, openOne.id)).toBeNull();
  });

  test('most recent judged by latest completedAt in the session', async () => {
    const a = await startSession(g.id, T0);
    await addSet(a.id, item, 60, 10, T0 + 1000);
    await finishSession(a.id, T0 + 2000);
    const b = await startSession(g.id, T0 + 10_000);
    await addSet(b.id, item, 65, 10, T0 + 11_000);
    await finishSession(b.id, T0 + 12_000);
    const cur = await startSession(g.id, T0 + 20_000);
    const last = await getLastTime(item.catalogId, g.id, cur.id);
    expect(last!.sessionId).toBe(b.id);
    expect(last!.date).toBe(T0 + 10_000);
  });
});

describe('prefill', () => {
  const mk = (order: number, weight: number, reps: number): SetEntry => ({
    id: String(order),
    sessionId: 's',
    gymId: 'g',
    catalogId: 'c',
    gymExerciseId: null,
    order,
    weight,
    reps,
    baseWeight: null,
    unit: 'kg',
    completedAt: order,
  });
  const last = (sets: SetEntry[]) => ({ sessionId: 'x', gymId: 'g', date: 0, sets });

  test('last current set wins; else last set of lastTime; else null', () => {
    expect(prefill([mk(1, 50, 10), mk(2, 55, 8)], last([mk(1, 40, 12)]))).toEqual({ weight: 55, reps: 8 });
    expect(prefill([], last([mk(1, 40, 12), mk(2, 42, 11)]))).toEqual({ weight: 42, reps: 11 });
    expect(prefill([], last([]))).toBeNull();
    expect(prefill([], null)).toBeNull();
  });
});

describe('sessionExercises', () => {
  test('groups by item in first-logged order', async () => {
    const f = await freeItem(g.id);
    const s = await startSession(g.id, T0);
    await addSet(s.id, f, 20, 5, T0 + 1);
    await addSet(s.id, item, 62, 10, T0 + 2);
    await addSet(s.id, f, 20, 5, T0 + 3);
    const ex = await sessionExercises(s.id);
    expect(ex.map((e) => e.key)).toEqual([f.key, item.key]);
    expect(ex[0]).toMatchObject({ catalogId: f.catalogId, gymExerciseId: null, firstAt: T0 + 1 });
    expect(ex[0].sets.length).toBe(2);
    expect(ex[1]).toMatchObject({ catalogId: item.catalogId, gymExerciseId: item.gymExerciseId, firstAt: T0 + 2 });
  });
});

describe('recomputePlateHistory', () => {
  test('shifts weight by newBase-oldBase only for sets with baseWeight===oldBase', async () => {
    const s = await startSession(g.id, T0);
    const a = await addSet(s.id, item, 62, 10, T0 + 1);
    const b = await addSet(s.id, item, 65, 10, T0 + 2);
    await finishSession(s.id, T0 + 3);
    await db.sets.update(b.id, { baseWeight: 60 }); // logged under a different base
    const changed = await recomputePlateHistory(item.gymExerciseId!, 62, 55);
    expect(changed).toBe(1);
    expect(await db.sets.get(a.id)).toMatchObject({ weight: 55, baseWeight: 55 });
    expect(await db.sets.get(b.id)).toMatchObject({ weight: 65, baseWeight: 60 });
  });
});

describe('deleting', () => {
  test('deleteSession removes the session and all its sets', async () => {
    const s = await startSession(g.id, T0);
    await addSet(s.id, item, 62, 10, T0 + 1);
    await addSet(s.id, item, 62, 10, T0 + 2);
    const other = await startSession(g.id, T0 + 10); // finishes s
    await addSet(other.id, item, 62, 10, T0 + 20);
    await deleteSession(s.id);
    expect(await db.sessions.get(s.id)).toBeUndefined();
    expect((await db.sets.toArray()).map((r) => r.sessionId)).toEqual([other.id]);
  });

  test('deleteExerciseSets removes one exercise from an open session and refuses an ended one', async () => {
    const s = await startSession(g.id, T0);
    const f = await freeItem(g.id);
    await addSet(s.id, item, 62, 10, T0 + 1);
    await addSet(s.id, item, 62, 10, T0 + 2);
    await addSet(s.id, f, 10, 10, T0 + 3);
    await deleteExerciseSets(s.id, item.key, T0 + 4);
    expect((await db.sets.toArray()).map((r) => r.catalogId)).toEqual([f.catalogId]);
    expect((await db.sessions.get(s.id))!.lastActivityAt).toBe(T0 + 4);
    await finishSession(s.id, T0 + 5);
    await expect(deleteExerciseSets(s.id, 'c:' + f.catalogId, T0 + 6)).rejects.toBeInstanceOf(SessionEndedError);
  });
});

describe('history editing', () => {
  test('deleteHistorySets works on ended sessions and removes a session left empty', async () => {
    const s = await startSession(g.id, T0);
    const a = await addSet(s.id, item, 62, 10, T0 + 1);
    const b = await addSet(s.id, item, 64, 8, T0 + 2);
    await finishSession(s.id, T0 + 3);
    await deleteHistorySets([a.id]);
    expect((await db.sets.toArray()).map((x) => x.id)).toEqual([b.id]);
    expect(await db.sessions.get(s.id)).toBeDefined();
    await deleteHistorySets([b.id, 'missing']);
    expect(await db.sets.count()).toBe(0);
    expect(await db.sessions.get(s.id)).toBeUndefined();
  });

  test('clearHistory removes every session and set but keeps gyms and machines', async () => {
    const s = await startSession(g.id, T0);
    await addSet(s.id, item, 62, 10, T0 + 1);
    await clearHistory();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
    expect(await db.gyms.count()).toBe(1);
    expect(await db.gymExercises.count()).toBe(1);
  });
});
