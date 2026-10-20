import type { PickerItem, Session, SetEntry } from '../domain/types';
import { db } from './db';

export interface LastTime {
  sessionId: string;
  gymId: string;
  date: number;
  sets: SetEntry[];
}

export interface ExerciseSummary {
  key: string;
  catalogId: string;
  gymExerciseId: string | null;
  firstAt: number;
  sets: SetEntry[];
}

/** Sets belong to open sessions only: editing closed sessions is out of scope for v1 (spec §3.4). */
export class SessionEndedError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} has ended`);
    this.name = 'SessionEndedError';
  }
}

const byOrder = (a: SetEntry, b: SetEntry) => a.order - b.order || a.completedAt - b.completedAt;

/** Open sessions are `endedAt === null`; IndexedDB cannot index null, so filter. */
const openSessions = () => db.sessions.filter((s) => s.endedAt === null);

/** Closes `id` at `endedAt`, or deletes it when it has no sets. Must run inside a rw transaction on sessions + sets. */
async function closeOrDelete(id: string, endedAt: number): Promise<void> {
  if ((await db.sets.where('sessionId').equals(id).count()) === 0) {
    await db.sessions.delete(id);
  } else {
    await db.sessions.update(id, { endedAt });
  }
}

/** True for an open session that the auto-close sweep would keep open at `now`. */
export function isResumable(s: Session, now: number, timeoutMin: number): boolean {
  return s.endedAt === null && now - s.lastActivityAt <= timeoutMin * 60_000;
}

export async function getOpenSession(): Promise<Session | null> {
  return (await openSessions().first()) ?? null;
}

export async function startSession(gymId: string, now: number): Promise<Session> {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    for (const open of await openSessions().toArray()) await closeOrDelete(open.id, now);
    const session: Session = { id: crypto.randomUUID(), gymId, startedAt: now, endedAt: null, lastActivityAt: now };
    await db.sessions.add(session);
    return session;
  });
}

/**
 * A gym tap on Home: closes timed-out sessions, then resumes the open session when it is at `gymId`,
 * otherwise finishes it and starts a new one. One transaction, so the check and the start cannot interleave.
 */
export async function startOrResumeSession(gymId: string, now: number, timeoutMin: number): Promise<Session> {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    await closeStaleSessions(now, timeoutMin);
    const open = await getOpenSession();
    if (open && open.gymId === gymId) return open;
    return startSession(gymId, now);
  });
}

export async function finishSession(id: string, now: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const s = await db.sessions.get(id);
    if (!s || s.endedAt !== null) return;
    await closeOrDelete(id, now);
  });
}

export async function closeStaleSessions(now: number, timeoutMin: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    for (const s of await openSessions().toArray()) {
      if (!isResumable(s, now, timeoutMin)) await closeOrDelete(s.id, s.lastActivityAt);
    }
  });
}

/** Deletes a session and every set logged in it. */
export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sets.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}

/**
 * History editing: deletes the given sets from any session, open or ended. A session left with no sets is
 * deleted too, so it no longer shows up in Progress.
 */
export async function deleteHistorySets(ids: string[]): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const sets = (await db.sets.bulkGet(ids)).filter((s): s is SetEntry => !!s);
    await db.sets.bulkDelete(sets.map((s) => s.id));
    for (const sessionId of new Set(sets.map((s) => s.sessionId))) {
      if ((await db.sets.where('sessionId').equals(sessionId).count()) === 0) await db.sessions.delete(sessionId);
    }
  });
}

/** Deletes every session and set; gyms, machines and settings stay. */
export async function clearHistory(): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sets.clear();
    await db.sessions.clear();
  });
}

// ---- sets ----

/** Must run inside a rw transaction on sessions. */
async function assertOpen(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (session && session.endedAt !== null) throw new SessionEndedError(sessionId);
}

const matchesItem = (s: SetEntry, item: { catalogId: string; gymExerciseId: string | null }) =>
  s.catalogId === item.catalogId && s.gymExerciseId === item.gymExerciseId;

export async function addSet(
  sessionId: string,
  item: PickerItem,
  weight: number,
  reps: number,
  now: number,
): Promise<SetEntry> {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.endedAt !== null) throw new SessionEndedError(sessionId);
    const existing = (await db.sets.where('sessionId').equals(sessionId).toArray()).filter((s) => matchesItem(s, item));
    const loading = item.loading;
    const entry: SetEntry = {
      id: crypto.randomUUID(),
      sessionId,
      gymId: session.gymId,
      catalogId: item.catalogId,
      gymExerciseId: item.gymExerciseId,
      order: existing.length + 1,
      weight,
      reps,
      baseWeight: loading.type === 'plate' || loading.type === 'plates' ? loading.base : null,
      unit: loading.type === 'stack' ? (loading.unit ?? 'kg') : 'kg',
      completedAt: now,
    };
    await db.sets.add(entry);
    await db.sessions.update(sessionId, { lastActivityAt: now });
    return entry;
  });
}

export async function updateSet(id: string, patch: { weight?: number; reps?: number }, now: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const s = await db.sets.get(id);
    if (!s) return;
    await assertOpen(s.sessionId);
    const changes: { weight?: number; reps?: number } = {};
    if (patch.weight !== undefined) changes.weight = patch.weight;
    if (patch.reps !== undefined) changes.reps = patch.reps;
    await db.sets.update(id, changes);
    await db.sessions.update(s.sessionId, { lastActivityAt: now });
  });
}

export async function deleteSet(id: string, now: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const s = await db.sets.get(id);
    if (!s) return;
    await assertOpen(s.sessionId);
    await db.sets.delete(id);
    await db.sessions.update(s.sessionId, { lastActivityAt: now });
  });
}

/** Deletes every set of one exercise (a `sessionExercises` key) from an open session. */
export async function deleteExerciseSets(sessionId: string, key: string, now: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await assertOpen(sessionId);
    const ids = (await db.sets.where('sessionId').equals(sessionId).toArray())
      .filter((s) => (s.gymExerciseId ?? 'c:' + s.catalogId) === key)
      .map((s) => s.id);
    await db.sets.bulkDelete(ids);
    if (await db.sessions.get(sessionId)) await db.sessions.update(sessionId, { lastActivityAt: now });
  });
}

export async function setsForItem(sessionId: string, item: PickerItem): Promise<SetEntry[]> {
  const all = await db.sets.where('sessionId').equals(sessionId).toArray();
  return all.filter((s) => matchesItem(s, item)).sort(byOrder);
}

// ---- last time / prefill ----

export async function getLastTime(
  catalogId: string,
  gymId: string,
  excludeSessionId: string,
): Promise<LastTime | null> {
  const sets = (await db.sets.where('catalogId').equals(catalogId).toArray()).filter(
    (s) => s.sessionId !== excludeSessionId,
  );
  if (sets.length === 0) return null;

  const bySession = new Map<string, SetEntry[]>();
  for (const s of sets) {
    const list = bySession.get(s.sessionId);
    if (list) list.push(s);
    else bySession.set(s.sessionId, [s]);
  }
  const latest = (list: SetEntry[]) => list.reduce((m, s) => Math.max(m, s.completedAt), -Infinity);

  const pick = (candidates: [string, SetEntry[]][]) =>
    candidates.reduce<[string, SetEntry[]] | null>((best, c) => (!best || latest(c[1]) > latest(best[1]) ? c : best), null);

  const all = [...bySession.entries()];
  const chosen = pick(all.filter(([, list]) => list[0].gymId === gymId)) ?? pick(all);
  if (!chosen) return null;

  const [sessionId, list] = chosen;
  const session = await db.sessions.get(sessionId);
  if (!session) return null;
  return { sessionId, gymId: session.gymId, date: session.startedAt, sets: list.sort(byOrder) };
}

/**
 * The next set's starting values. Set N starts from set N of last time, so a ramp-up repeats itself; where last
 * time was climbing or holding, it never starts below today's latest weight. Past the end of last time it starts
 * from this session's latest set. `fromLast` says set N of last time was followed; `snap` that the weight is
 * last time's (today's weights may be typed values that are not on the wheel).
 */
export function prefill(
  current: SetEntry[],
  last: LastTime | null,
): { weight: number; reps: number; fromLast: boolean; snap: boolean } | null {
  const pickLast = (sets: SetEntry[]) => (sets.length ? [...sets].sort(byOrder)[sets.length - 1] : null);
  const lastSets = last ? [...last.sets].sort(byOrder) : [];
  const latest = pickLast(current);
  const next = lastSets[current.length];
  if (next) {
    const prev = lastSets[current.length - 1];
    const keep = !!latest && !!prev && next.weight >= prev.weight && latest.weight > next.weight;
    return { weight: keep ? latest.weight : next.weight, reps: next.reps, fromLast: true, snap: !keep };
  }
  return latest ? { weight: latest.weight, reps: latest.reps, fromLast: false, snap: false } : null;
}

/**
 * Earlier sessions' sets to compare this session's records against: the same machine for machine exercises
 * (machines differ between gyms), the same exercise at any gym otherwise.
 */
export async function recordHistory(item: PickerItem, byMachine: boolean, excludeSessionId: string): Promise<SetEntry[]> {
  const sets =
    byMachine && item.gymExerciseId
      ? await db.sets.where('gymExerciseId').equals(item.gymExerciseId).toArray()
      : await db.sets.where('catalogId').equals(item.catalogId).toArray();
  return sets.filter((s) => s.sessionId !== excludeSessionId);
}

// ---- body weight ----

/** Notes the body weight on an open session; null clears it. Not counted as activity. */
export async function setSessionBodyweight(sessionId: string, kg: number | null): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    await assertOpen(sessionId);
    await db.sessions.update(sessionId, { bodyweight: kg });
  });
}

/** The most recent body weight noted in any other session. */
export async function lastBodyweight(excludeSessionId: string): Promise<number | null> {
  const s = await db.sessions
    .orderBy('startedAt')
    .reverse()
    .filter((x) => x.id !== excludeSessionId && typeof x.bodyweight === 'number')
    .first();
  return s?.bodyweight ?? null;
}

// ---- session summary ----

export async function sessionExercises(sessionId: string): Promise<ExerciseSummary[]> {
  const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
  const groups = new Map<string, ExerciseSummary>();
  for (const s of sets.sort((a, b) => a.completedAt - b.completedAt || a.order - b.order)) {
    const key = s.gymExerciseId ?? 'c:' + s.catalogId;
    const g = groups.get(key);
    if (g) g.sets.push(s);
    else groups.set(key, { key, catalogId: s.catalogId, gymExerciseId: s.gymExerciseId, firstAt: s.completedAt, sets: [s] });
  }
  const out = [...groups.values()];
  for (const g of out) g.sets.sort(byOrder);
  return out.sort((a, b) => a.firstAt - b.firstAt);
}

// ---- plate base edit ----

export async function recomputePlateHistory(gymExerciseId: string, oldBase: number, newBase: number): Promise<number> {
  return db.transaction('rw', db.sets, async () => {
    const hit = (await db.sets.where('gymExerciseId').equals(gymExerciseId).toArray()).filter(
      (s) => s.baseWeight === oldBase,
    );
    const delta = newBase - oldBase;
    for (const s of hit) await db.sets.update(s.id, { weight: s.weight + delta, baseWeight: newBase });
    return hit.length;
  });
}
