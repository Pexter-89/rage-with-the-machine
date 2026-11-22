import { CATEGORIES, equipmentOf } from '../domain/catalog.js';
import { sameLoading } from '../domain/loading.js';
import { addCustomEntries, getCatalog } from './catalogRepo.js';
import { db } from './db.js';

export class GymHasSessionsError extends Error {
  constructor(gymId) {
    super(`Gym ${gymId} has sessions and cannot be deleted`);
    this.name = 'GymHasSessionsError';
  }
}

// ---- gyms ----

/**
 * @param {string} name
 * @returns {Promise<Gym>}
 */
export async function addGym(name) {
  return db.transaction('rw', db.gyms, async () => {
    const all = await db.gyms.toArray();
    const order = all.reduce((m, g) => Math.max(m, g.order), -1) + 1;
    const gym = { id: crypto.randomUUID(), name, order, archived: false };
    await db.gyms.add(gym);
    return gym;
  });
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function renameGym(id, name) {
  await db.gyms.update(id, { name });
}

/**
 * @param {{ includeArchived?: boolean }} [opts={}]
 * @returns {Promise<Gym[]>}
 */
export async function listGyms(opts = {}) {
  const all = await db.gyms.orderBy('order').toArray();
  return opts.includeArchived ? all : all.filter((g) => !g.archived);
}

/**
 * Swaps `order` with the neighbour among active (non-archived) gyms; no-op at the ends.
 * @param {string} id
 * @param {-1 | 1} delta
 * @returns {Promise<void>}
 */
export async function moveGym(id, delta) {
  await db.transaction('rw', db.gyms, async () => {
    const active = (await db.gyms.orderBy('order').toArray()).filter((g) => !g.archived);
    const i = active.findIndex((g) => g.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= active.length) return;
    const a = active[i];
    const b = active[j];
    await db.gyms.update(a.id, { order: b.order });
    await db.gyms.update(b.id, { order: a.order });
  });
}

/**
 * @param {string} id
 * @param {boolean} archived
 * @returns {Promise<void>}
 */
export async function setGymArchived(id, archived) {
  await db.gyms.update(id, { archived });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteGym(id) {
  await db.transaction('rw', db.gyms, db.gymExercises, db.sessions, async () => {
    if ((await db.sessions.where('gymId').equals(id).count()) > 0) throw new GymHasSessionsError(id);
    await db.gymExercises.where('gymId').equals(id).delete();
    await db.gyms.delete(id);
  });
}

// ---- gym exercises ----

/**
 * @param {Omit<GymExercise, 'id'> & { id?: string }} ge
 * @returns {Promise<GymExercise>}
 */
export async function saveGymExercise(ge) {
  const saved = { ...ge, id: ge.id ?? crypto.randomUUID(), loading: structuredClone(ge.loading) };
  await db.gymExercises.put(saved);
  return saved;
}

/**
 * @param {string} id
 * @param {string} notes
 * @returns {Promise<void>}
 */
export async function setGymExerciseNotes(id, notes) {
  await db.gymExercises.update(id, { notes: notes.trim() });
}

/**
 * @param {GymExercise} ge
 * @param {ParsedMachine} m
 */
const sameMachine = (ge, m) =>
  ge.catalogId === m.catalogId && ge.label === m.label && sameLoading(ge.loading, m.loading);

/**
 * For each parsed machine, whether the gym already has it (same exercise, label and loading; hidden ones count).
 * @param {string} gymId
 * @param {ParsedMachine[]} machines
 * @returns {Promise<boolean[]>}
 */
export async function machinesAlreadyAtGym(gymId, machines) {
  const mine = await db.gymExercises.where('gymId').equals(gymId).toArray();
  return machines.map((m) => mine.some((ge) => sameMachine(ge, m)));
}

/**
 * Atomic: skips machines the gym already has, adds the custom catalogue entries the rest need, then one
 * GymExercise per remaining machine. A free-weight or bodyweight setting replaces the gym's existing one for
 * that exercise (a gym has at most one). Returns the created or updated ones; any failure adds nothing.
 * @param {string} gymId
 * @param {Extract<ParseResult, { ok: true }>} parsed
 * @returns {Promise<GymExercise[]>}
 */
export async function importMachines(gymId, parsed) {
  return db.transaction('rw', [db.customCatalog, db.gymExercises], async () => {
    const already = await machinesAlreadyAtGym(gymId, parsed.machines);
    const fresh = parsed.machines.filter((_, i) => !already[i]);
    const needed = new Set(fresh.map((m) => m.catalogId));
    const newExercises = parsed.newExercises.filter((e) => needed.has(e.id));
    if (newExercises.length > 0) await addCustomEntries(newExercises);
    const byId = new Map((await getCatalog()).map((e) => [e.id, e]));
    const mine = await db.gymExercises.where('gymId').equals(gymId).toArray();
    const saved = [];
    for (const m of fresh) {
      const entry = byId.get(m.catalogId);
      const existing = entry && isFreeLike(entry) ? mine.find((ge) => ge.catalogId === m.catalogId) : undefined;
      saved.push(
        await saveGymExercise({
          id: existing?.id,
          gymId,
          catalogId: m.catalogId,
          label: m.label,
          notes: m.notes,
          loading: m.loading,
          hidden: m.hidden ?? false,
        }),
      );
    }
    return saved;
  });
}

/**
 * @typedef {object} ReplaceSummary
 * @property {number} updated Machines in the file that matched one already at the gym (same exercise and label) and were updated.
 * @property {number} added
 * @property {number} removed Gone from the file and never logged: deleted.
 * @property {number} hidden Gone from the file but with logged sets: hidden, so their history keeps its machine.
 */

/**
 * What `replaceGymEquipment` would do, without doing it.
 * @param {string} gymId
 * @param {ParsedMachine[]} machines
 * @returns {Promise<ReplaceSummary>}
 */
export async function planReplace(gymId, machines) {
  const mine = await db.gymExercises.where('gymId').equals(gymId).toArray();
  const used = new Set();
  let updated = 0;
  for (const m of machines) {
    const match = mine.find((ge) => !used.has(ge.id) && ge.catalogId === m.catalogId && ge.label === m.label);
    if (match) {
      used.add(match.id);
      updated++;
    }
  }
  let removed = 0;
  let hidden = 0;
  for (const ge of mine) {
    if (used.has(ge.id)) continue;
    if ((await db.sets.where('gymExerciseId').equals(ge.id).count()) > 0) hidden++;
    else removed++;
  }
  return { updated, added: machines.length - updated, removed, hidden };
}

/**
 * Replaces a gym's equipment with a file's, atomically. A machine with the same exercise and label as one at
 * the gym updates it in place (so its history stays linked); the rest are added. Equipment missing from the
 * file is deleted, or hidden when it has logged sets.
 * @param {string} gymId
 * @param {Extract<ParseResult, { ok: true }>} parsed
 * @returns {Promise<ReplaceSummary>}
 */
export async function replaceGymEquipment(gymId, parsed) {
  return db.transaction('rw', [db.customCatalog, db.gymExercises, db.sets], async () => {
    const summary = await planReplace(gymId, parsed.machines);
    const needed = new Set(parsed.machines.map((m) => m.catalogId));
    const newExercises = parsed.newExercises.filter((e) => needed.has(e.id));
    if (newExercises.length > 0) await addCustomEntries(newExercises);
    const mine = await db.gymExercises.where('gymId').equals(gymId).toArray();
    const used = new Set();
    for (const m of parsed.machines) {
      const match = mine.find((ge) => !used.has(ge.id) && ge.catalogId === m.catalogId && ge.label === m.label);
      if (match) used.add(match.id);
      await saveGymExercise({
        id: match?.id,
        gymId,
        catalogId: m.catalogId,
        label: m.label,
        notes: m.notes,
        loading: m.loading,
        hidden: m.hidden ?? false,
      });
    }
    for (const ge of mine) {
      if (used.has(ge.id)) continue;
      if ((await db.sets.where('gymExerciseId').equals(ge.id).count()) > 0)
        await db.gymExercises.update(ge.id, { hidden: true });
      else await db.gymExercises.delete(ge.id);
    }
    return summary;
  });
}

/**
 * Creates a gym named `name` with a file's equipment.
 * @param {string} name
 * @param {Extract<ParseResult, { ok: true }>} parsed
 * @returns {Promise<Gym>}
 */
export async function addGymFromFile(name, parsed) {
  return db.transaction('rw', [db.gyms, db.customCatalog, db.gymExercises], async () => {
    const gym = await addGym(name);
    await importMachines(gym.id, parsed);
    return gym;
  });
}

/**
 * A gym and its equipment as a machine file (the format Claude writes, plus the gym's name), for sending to
 * someone else or for editing with Claude. Custom exercises travel as `newExercise`.
 * @param {string} gymId
 * @returns {Promise<object>}
 */
export async function exportGymFile(gymId) {
  const [gym, mine, catalog] = await Promise.all([
    db.gyms.get(gymId),
    db.gymExercises.where('gymId').equals(gymId).toArray(),
    getCatalog(),
  ]);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const machines = mine
    .filter((ge) => byId.has(ge.catalogId))
    .sort((a, b) => byName(byId.get(a.catalogId), byId.get(b.catalogId)) || a.label.localeCompare(b.label))
    .map((ge) => {
      const e = byId.get(ge.catalogId);
      return {
        exercise: ge.catalogId,
        newExercise: e.builtIn ? null : { id: e.id, name: e.name, category: e.category, kind: e.kind },
        label: ge.label,
        loading: ge.loading,
        notes: ge.notes,
        ...(ge.hidden ? { hidden: true } : {}),
      };
    });
  return { format: 'rwtm-machine', version: 1, gym: { name: gym?.name ?? '' }, machines };
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteGymExercise(id) {
  await db.gymExercises.delete(id);
}

/**
 * @param {CatalogExercise | undefined} a
 * @param {CatalogExercise | undefined} b
 * @returns {number}
 */
function byName(a, b) {
  return (a?.name ?? '').localeCompare(b?.name ?? '');
}

/**
 * Machine GymExercises of a gym (hidden included: the gym screen edits them), by catalogue name then label.
 * @param {string} gymId
 * @returns {Promise<GymExercise[]>}
 */
export async function listGymMachines(gymId) {
  const [mine, catalog] = await Promise.all([db.gymExercises.where('gymId').equals(gymId).toArray(), getCatalog()]);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  return mine
    .filter((ge) => byId.get(ge.catalogId)?.kind === 'machine')
    .sort((a, b) => byName(byId.get(a.catalogId), byId.get(b.catalogId)) || a.label.localeCompare(b.label));
}

// ---- picker ----

/**
 * @param {CatalogExercise} entry
 * @param {GymExercise | null} ge
 * @returns {PickerItem}
 */
function itemFor(entry, ge) {
  const loading = ge ? ge.loading : entry.defaultLoading;
  return {
    key: ge ? ge.id : 'c:' + entry.id,
    catalogId: entry.id,
    gymExerciseId: ge ? ge.id : null,
    name: entry.name,
    label: ge ? ge.label : '',
    notes: ge ? ge.notes : '',
    category: entry.category,
    equipment: equipmentOf(entry),
    loading: structuredClone(loading),
    unilateral: !!entry.unilateral,
    assisted: !!entry.assisted,
  };
}

/** @param {CatalogExercise} e */
const isFreeLike = (e) => e.kind === 'free' || e.kind === 'bodyweight';

/**
 * @param {string} gymId
 * @param {CatalogExercise[]} catalog
 * @returns {Promise<PickerItem[]>}
 */
export async function availableExercises(gymId, catalog) {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const mine = await db.gymExercises.where('gymId').equals(gymId).toArray();

  const items = new Map();
  for (const e of catalog) {
    if (isFreeLike(e) && e.defaultLoading) items.set('c:' + e.id, itemFor(e, null));
  }
  for (const ge of mine) {
    const entry = byId.get(ge.catalogId);
    if (!entry) continue;
    if (isFreeLike(entry)) {
      // A GymExercise on a free/bodyweight entry overrides it (or removes it when hidden).
      items.delete('c:' + entry.id);
    }
    if (ge.hidden) continue;
    items.set(ge.id, itemFor(entry, ge));
  }

  const rank = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  return [...items.values()].sort(
    (a, b) =>
      (rank.get(a.category) ?? 0) - (rank.get(b.category) ?? 0) ||
      a.name.localeCompare(b.name) ||
      a.label.localeCompare(b.label),
  );
}

/**
 * Resolves a picker key. A gymExerciseId key resolves even when the GymExercise is hidden
 * (so history can still be labelled); a 'c:' key resolves to the catalogue's virtual item.
 * @param {string} gymId
 * @param {string} key
 * @param {CatalogExercise[]} catalog
 * @returns {Promise<PickerItem | null>}
 */
export async function resolveItem(gymId, key, catalog) {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  if (key.startsWith('c:')) {
    const entry = byId.get(key.slice(2));
    return entry && isFreeLike(entry) && entry.defaultLoading ? itemFor(entry, null) : null;
  }
  const ge = await db.gymExercises.get(key);
  if (!ge || ge.gymId !== gymId) return null;
  const entry = byId.get(ge.catalogId);
  return entry ? itemFor(entry, ge) : null;
}
