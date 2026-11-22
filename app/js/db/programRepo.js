import { clampItem, programFromSets } from '../domain/programs.js';
import { db } from './db.js';
import { closeStaleSessions, getOpenSession, startSession } from './sessionRepo.js';

/** @typedef {import('../domain/types.js').Program} Program */
/** @typedef {import('../domain/types.js').ProgramItem} ProgramItem */
/** @typedef {import('../domain/types.js').Session} Session */

/**
 * @param {string} name
 * @returns {string}
 */
const cleanName = (name) => name.trim() || 'Program';

/**
 * Programs that are not archived, in `order`.
 * @returns {Promise<Program[]>}
 */
export async function listPrograms() {
  return (await db.programs.orderBy('order').toArray()).filter((p) => !p.archived);
}

/**
 * @param {string} id
 * @returns {Promise<Program | undefined>}
 */
export async function getProgram(id) {
  return db.programs.get(id);
}

/**
 * Adds a program at the end of the list.
 * @param {{ name: string, items: ProgramItem[] }} fields
 * @param {number} now
 * @returns {Promise<Program>}
 */
export async function addProgram({ name, items }, now) {
  return db.transaction('rw', db.programs, async () => {
    const order = (await db.programs.toArray()).reduce((m, p) => Math.max(m, p.order), -1) + 1;
    const program = {
      id: crypto.randomUUID(),
      name: cleanName(name),
      order,
      archived: false,
      items: items.map(clampItem),
      createdAt: now,
      updatedAt: now,
    };
    await db.programs.add(program);
    return program;
  });
}

/**
 * Renames a program and replaces its items. Sessions already started from it keep their own plan.
 * @param {string} id
 * @param {{ name: string, items: ProgramItem[] }} fields
 * @param {number} now
 * @returns {Promise<void>}
 */
export async function updateProgram(id, { name, items }, now) {
  await db.programs.update(id, { name: cleanName(name), items: items.map(clampItem), updatedAt: now });
}

/**
 * Deletes a program. Sessions started from it keep their plan; their `programId` just points nowhere.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteProgram(id) {
  await db.programs.delete(id);
}

/**
 * Swaps `order` with the neighbour among listed (non-archived) programs; no-op at the ends.
 * @param {string} id
 * @param {-1 | 1} delta
 * @returns {Promise<void>}
 */
export async function moveProgram(id, delta) {
  await db.transaction('rw', db.programs, async () => {
    const list = await listPrograms();
    const i = list.findIndex((p) => p.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    await db.programs.update(list[i].id, { order: list[j].order });
    await db.programs.update(list[j].id, { order: list[i].order });
  });
}

/**
 * Starts a session from a program at a gym, with a snapshot of its items as the plan. Like a gym tap on Home:
 * an open session at the same gym is kept (and gets this plan), an open session elsewhere is finished.
 * @param {string} gymId
 * @param {string} programId
 * @param {number} now
 * @param {number} timeoutMin
 * @returns {Promise<Session>}
 */
export async function startProgramSession(gymId, programId, now, timeoutMin) {
  return db.transaction('rw', [db.sessions, db.sets, db.programs], async () => {
    const program = await db.programs.get(programId);
    if (!program) throw new Error('This program no longer exists');
    await closeStaleSessions(now, timeoutMin);
    const open = await getOpenSession();
    const session = open && open.gymId === gymId ? open : await startSession(gymId, now);
    const plan = structuredClone(program.items);
    await db.sessions.update(session.id, { programId, plan });
    return { ...session, programId, plan };
  });
}

/**
 * Replaces one plan item's exercise (keeping its sets × reps), for an exercise this gym does not have.
 * Only the session changes, never the program.
 * @param {string} sessionId
 * @param {number} index
 * @param {string} catalogId
 * @returns {Promise<void>}
 */
export async function swapPlanItem(sessionId, index, catalogId) {
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s?.plan?.[index]) return;
    const plan = s.plan.map((p, i) => (i === index ? { ...p, catalogId } : p));
    await db.sessions.update(sessionId, { plan });
  });
}

/**
 * A new program from what a session logged (see `programFromSets`). Throws when it has no sets.
 * @param {string} sessionId
 * @param {string} name
 * @param {number} now
 * @returns {Promise<Program>}
 */
export async function saveSessionAsProgram(sessionId, name, now) {
  return db.transaction('rw', [db.sets, db.programs], async () => {
    const items = programFromSets(await db.sets.where('sessionId').equals(sessionId).toArray());
    if (items.length === 0) throw new Error('This session has no sets to save');
    return addProgram({ name, items }, now);
  });
}
