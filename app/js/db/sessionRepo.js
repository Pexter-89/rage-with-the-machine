import { db } from './db.js';

/**
 * @typedef {object} LastTime
 * @property {string} sessionId
 * @property {string} gymId
 * @property {number} date
 * @property {SetEntry[]} sets
 */

/**
 * @typedef {object} ExerciseSummary
 * @property {string} key
 * @property {string} catalogId
 * @property {string | null} gymExerciseId
 * @property {number} firstAt
 * @property {SetEntry[]} sets
 */

/** Sets belong to open sessions only: editing closed sessions is out of scope for v1 (spec §3.4). */
export class SessionEndedError extends Error {
  constructor(sessionId) {
    super(`Session ${sessionId} has ended`);
    this.name = 'SessionEndedError';
  }
}

/**
 * @param {SetEntry} a
 * @param {SetEntry} b
 */
const byOrder = (a, b) => a.order - b.order || a.completedAt - b.completedAt;

/** Open sessions are `endedAt === null`; IndexedDB cannot index null, so filter. */
const openSessions = () => db.sessions.filter((s) => s.endedAt === null);

/**
 * Closes `id` at `endedAt`, or deletes it when it has no sets. Must run inside a rw transaction on sessions + sets.
 * @param {string} id
 * @param {number} endedAt
 * @returns {Promise<void>}
 */
async function closeOrDelete(id, endedAt) {
  if ((await db.sets.where('sessionId').equals(id).count()) === 0) {
    await db.sessions.delete(id);
  } else {
    await db.sessions.update(id, { endedAt });
  }
}

/**
 * True for an open session that the auto-close sweep would keep open at `now`.
 * @param {Session} s
 * @param {number} now
 * @param {number} timeoutMin
 * @returns {boolean}
 */
export function isResumable(s, now, timeoutMin) {
  return s.endedAt === null && now - s.lastActivityAt <= timeoutMin * 60_000;
}

/** @returns {Promise<Session | null>} */
export async function getOpenSession() {
  return (await openSessions().first()) ?? null;
}

/**
 * @param {string} gymId
 * @param {number} now
 * @returns {Promise<Session>}
 */
export async function startSession(gymId, now) {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    for (const open of await openSessions().toArray()) await closeOrDelete(open.id, now);
    const session = { id: crypto.randomUUID(), gymId, startedAt: now, endedAt: null, lastActivityAt: now };
    await db.sessions.add(session);
    return session;
  });
}

/**
 * A gym tap on Home: closes timed-out sessions, then resumes the open session when it is at `gymId`,
 * otherwise finishes it and starts a new one. One transaction, so the check and the start cannot interleave.
 * @param {string} gymId
 * @param {number} now
 * @param {number} timeoutMin
 * @returns {Promise<Session>}
 */
export async function startOrResumeSession(gymId, now, timeoutMin) {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    await closeStaleSessions(now, timeoutMin);
    const open = await getOpenSession();
    if (open && open.gymId === gymId) return open;
    return startSession(gymId, now);
  });
}

/**
 * @param {string} id
 * @param {number} now
 * @returns {Promise<void>}
 */
export async function finishSession(id, now) {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const s = await db.sessions.get(id);
    if (!s || s.endedAt !== null) return;
    await closeOrDelete(id, now);
  });
}

/**
 * @param {number} now
 * @param {number} timeoutMin
 * @returns {Promise<void>}
 */
export async function closeStaleSessions(now, timeoutMin) {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    for (const s of await openSessions().toArray()) {
      if (!isResumable(s, now, timeoutMin)) await closeOrDelete(s.id, s.lastActivityAt);
    }
  });
}

/**
 * Deletes a session and every set logged in it.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteSession(id) {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sets.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}

/**
 * History editing: deletes the given sets from any session, open or ended. A session left with no sets is
 * deleted too, so it no longer shows up in Progress.
 * @param {string[]} ids
 * @returns {Promise<void>}
 */
export async function deleteHistorySets(ids) {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const sets = (await db.sets.bulkGet(ids)).filter((s) => !!s);
    await db.sets.bulkDelete(sets.map((s) => s.id));
    for (const sessionId of new Set(sets.map((s) => s.sessionId))) {
      if ((await db.sets.where('sessionId').equals(sessionId).count()) === 0) await db.sessions.delete(sessionId);
    }
  });
}

/**
 * Deletes every session and set; gyms, machines and settings stay.
 * @returns {Promise<void>}
 */
export async function clearHistory() {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sets.clear();
    await db.sessions.clear();
  });
}

// ---- sets ----

/**
 * Must run inside a rw transaction on sessions.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function assertOpen(sessionId) {
  const session = await db.sessions.get(sessionId);
  if (session && session.endedAt !== null) throw new SessionEndedError(sessionId);
}

/**
 * @param {SetEntry} s
 * @param {{ catalogId: string, gymExerciseId: string | null }} item
 */
const matchesItem = (s, item) => s.catalogId === item.catalogId && s.gymExerciseId === item.gymExerciseId;

/**
 * @param {string} sessionId
 * @param {PickerItem} item
 * @param {number} weight
 * @param {number} reps
 * @param {number} now
 * @returns {Promise<SetEntry>}
 */
export async function addSet(sessionId, item, weight, reps, now) {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.endedAt !== null) throw new SessionEndedError(sessionId);
    const existing = (await db.sets.where('sessionId').equals(sessionId).toArray()).filter((s) => matchesItem(s, item));
    const loading = item.loading;
    const entry = {
      id: crypto.randomUUID(),
      sessionId,
      gymId: session.gymId,
      catalogId: item.catalogId,
      gymExerciseId: item.gymExerciseId,
      order: existing.reduce((m, x) => Math.max(m, x.order), 0) + 1,
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

/**
 * @param {string} id
 * @param {{ weight?: number, reps?: number }} patch
 * @param {number} now
 * @returns {Promise<void>}
 */
export async function updateSet(id, patch, now) {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const s = await db.sets.get(id);
    if (!s) return;
    await assertOpen(s.sessionId);
    const changes = {};
    if (patch.weight !== undefined) changes.weight = patch.weight;
    if (patch.reps !== undefined) changes.reps = patch.reps;
    await db.sets.update(id, changes);
    await db.sessions.update(s.sessionId, { lastActivityAt: now });
  });
}

/**
 * @param {string} id
 * @param {number} now
 * @returns {Promise<void>}
 */
export async function deleteSet(id, now) {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const s = await db.sets.get(id);
    if (!s) return;
    await assertOpen(s.sessionId);
    await db.sets.delete(id);
    await db.sessions.update(s.sessionId, { lastActivityAt: now });
  });
}

/**
 * Deletes every set of one exercise (a `sessionExercises` key) from an open session.
 * @param {string} sessionId
 * @param {string} key
 * @param {number} now
 * @returns {Promise<void>}
 */
export async function deleteExerciseSets(sessionId, key, now) {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await assertOpen(sessionId);
    const ids = (await db.sets.where('sessionId').equals(sessionId).toArray())
      .filter((s) => (s.gymExerciseId ?? 'c:' + s.catalogId) === key)
      .map((s) => s.id);
    await db.sets.bulkDelete(ids);
    if (await db.sessions.get(sessionId)) await db.sessions.update(sessionId, { lastActivityAt: now });
  });
}

/**
 * @param {string} sessionId
 * @param {PickerItem} item
 * @returns {Promise<SetEntry[]>}
 */
export async function setsForItem(sessionId, item) {
  const all = await db.sets.where('sessionId').equals(sessionId).toArray();
  return all.filter((s) => matchesItem(s, item)).sort(byOrder);
}

// ---- last time / prefill ----

/**
 * @param {string} catalogId
 * @param {string} gymId
 * @param {string} excludeSessionId
 * @returns {Promise<LastTime | null>}
 */
export async function getLastTime(catalogId, gymId, excludeSessionId) {
  const sets = (await db.sets.where('catalogId').equals(catalogId).toArray()).filter(
    (s) => s.sessionId !== excludeSessionId,
  );
  if (sets.length === 0) return null;

  const bySession = new Map();
  for (const s of sets) {
    const list = bySession.get(s.sessionId);
    if (list) list.push(s);
    else bySession.set(s.sessionId, [s]);
  }
  const latest = (list) => list.reduce((m, s) => Math.max(m, s.completedAt), -Infinity);

  const pick = (candidates) =>
    candidates.reduce((best, c) => (!best || latest(c[1]) > latest(best[1]) ? c : best), null);

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
 * @param {SetEntry[]} current
 * @param {LastTime | null} last
 * @returns {{ weight: number, reps: number, fromLast: boolean, snap: boolean } | null}
 */
export function prefill(current, last) {
  const pickLast = (sets) => (sets.length ? [...sets].sort(byOrder)[sets.length - 1] : null);
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
 * @param {PickerItem} item
 * @param {boolean} byMachine
 * @param {string} excludeSessionId
 * @param {string} gymId
 * @returns {Promise<SetEntry[]>}
 */
export async function recordHistory(item, byMachine, excludeSessionId, gymId) {
  let sets;
  if (byMachine && item.gymExerciseId) sets = await db.sets.where('gymExerciseId').equals(item.gymExerciseId).toArray();
  else {
    sets = await db.sets.where('catalogId').equals(item.catalogId).toArray();
    // A machine not set up at this gym has no identity: only the same gym's un-set-up sets are the same machine.
    if (byMachine) sets = sets.filter((s) => s.gymId === gymId && !s.gymExerciseId);
  }
  return sets.filter((s) => s.sessionId !== excludeSessionId);
}

// ---- body weight ----

/**
 * Notes the body weight on an open session; null clears it. Not counted as activity.
 * @param {string} sessionId
 * @param {number | null} kg
 * @returns {Promise<void>}
 */
export async function setSessionBodyweight(sessionId, kg) {
  await db.transaction('rw', db.sessions, async () => {
    await assertOpen(sessionId);
    await db.sessions.update(sessionId, { bodyweight: kg });
  });
}

/**
 * Corrects the body weight of any session, open or ended (from Progress history); null clears it. Unlike
 * `setSessionBodyweight` this does not require the session to be open, and it checks the value itself.
 * @param {string} sessionId
 * @param {number | null} kg
 * @returns {Promise<void>}
 */
export async function setHistoryBodyweight(sessionId, kg) {
  if (kg !== null && !(Number.isFinite(kg) && kg > 0 && kg < 500)) {
    throw new RangeError('Body weight must be more than 0 and less than 500 kg');
  }
  await db.transaction('rw', db.sessions, async () => {
    if (!(await db.sessions.get(sessionId))) throw new Error('Session not found');
    await db.sessions.update(sessionId, { bodyweight: kg });
  });
}

/**
 * The most recent body weight noted in any other session.
 * @param {string} excludeSessionId
 * @returns {Promise<number | null>}
 */
export async function lastBodyweight(excludeSessionId) {
  const s = await db.sessions
    .orderBy('startedAt')
    .reverse()
    .filter((x) => x.id !== excludeSessionId && typeof x.bodyweight === 'number')
    .first();
  return s?.bodyweight ?? null;
}

// ---- session summary ----

/**
 * @param {string} sessionId
 * @returns {Promise<ExerciseSummary[]>}
 */
export async function sessionExercises(sessionId) {
  const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
  const groups = new Map();
  for (const s of sets.sort((a, b) => a.completedAt - b.completedAt || a.order - b.order)) {
    const key = s.gymExerciseId ?? 'c:' + s.catalogId;
    const g = groups.get(key);
    if (g) g.sets.push(s);
    else
      groups.set(key, {
        key,
        catalogId: s.catalogId,
        gymExerciseId: s.gymExerciseId,
        firstAt: s.completedAt,
        sets: [s],
      });
  }
  const out = [...groups.values()];
  for (const g of out) g.sets.sort(byOrder);
  return out.sort((a, b) => a.firstAt - b.firstAt);
}

// ---- plate base edit ----

/**
 * @param {string} gymExerciseId
 * @param {number} oldBase
 * @param {number} newBase
 * @returns {Promise<number>}
 */
export async function recomputePlateHistory(gymExerciseId, oldBase, newBase) {
  return db.transaction('rw', db.sets, async () => {
    const hit = (await db.sets.where('gymExerciseId').equals(gymExerciseId).toArray()).filter(
      (s) => s.baseWeight === oldBase,
    );
    const delta = newBase - oldBase;
    for (const s of hit) await db.sets.update(s.id, { weight: s.weight + delta, baseWeight: newBase });
    return hit.length;
  });
}
