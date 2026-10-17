import { CATEGORIES } from '../domain/catalog';
import type { ParsedMachine, ParseResult } from '../domain/importMachine';
import { sameLoading } from '../domain/loading';
import type { CatalogExercise, Gym, GymExercise, PickerItem } from '../domain/types';
import { addCustomEntries, getCatalog } from './catalogRepo';
import { db } from './db';

export class GymHasSessionsError extends Error {
  constructor(gymId: string) {
    super(`Gym ${gymId} has sessions and cannot be deleted`);
    this.name = 'GymHasSessionsError';
  }
}

// ---- gyms ----

export async function addGym(name: string): Promise<Gym> {
  return db.transaction('rw', db.gyms, async () => {
    const all = await db.gyms.toArray();
    const order = all.reduce((m, g) => Math.max(m, g.order), -1) + 1;
    const gym: Gym = { id: crypto.randomUUID(), name, order, archived: false };
    await db.gyms.add(gym);
    return gym;
  });
}

export async function renameGym(id: string, name: string): Promise<void> {
  await db.gyms.update(id, { name });
}

export async function listGyms(opts: { includeArchived?: boolean } = {}): Promise<Gym[]> {
  const all = await db.gyms.orderBy('order').toArray();
  return opts.includeArchived ? all : all.filter((g) => !g.archived);
}

/** Swaps `order` with the neighbour among active (non-archived) gyms; no-op at the ends. */
export async function moveGym(id: string, delta: -1 | 1): Promise<void> {
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

export async function setGymArchived(id: string, archived: boolean): Promise<void> {
  await db.gyms.update(id, { archived });
}

export async function deleteGym(id: string): Promise<void> {
  await db.transaction('rw', db.gyms, db.gymExercises, db.sessions, async () => {
    if ((await db.sessions.where('gymId').equals(id).count()) > 0) throw new GymHasSessionsError(id);
    await db.gymExercises.where('gymId').equals(id).delete();
    await db.gyms.delete(id);
  });
}

// ---- gym exercises ----

export async function saveGymExercise(ge: Omit<GymExercise, 'id'> & { id?: string }): Promise<GymExercise> {
  const saved: GymExercise = { ...ge, id: ge.id ?? crypto.randomUUID(), loading: structuredClone(ge.loading) };
  await db.gymExercises.put(saved);
  return saved;
}

const sameMachine = (ge: GymExercise, m: ParsedMachine) =>
  ge.catalogId === m.catalogId && ge.label === m.label && sameLoading(ge.loading, m.loading);

/** For each parsed machine, whether the gym already has it (same exercise, label and loading; hidden ones count). */
export async function machinesAlreadyAtGym(gymId: string, machines: ParsedMachine[]): Promise<boolean[]> {
  const mine = await db.gymExercises.where('gymId').equals(gymId).toArray();
  return machines.map((m) => mine.some((ge) => sameMachine(ge, m)));
}

/**
 * Atomic: skips machines the gym already has, adds the custom catalogue entries the rest need, then one
 * visible GymExercise per remaining machine. Returns only the created ones; any failure adds nothing.
 */
export async function importMachines(gymId: string, parsed: Extract<ParseResult, { ok: true }>): Promise<GymExercise[]> {
  return db.transaction('rw', [db.customCatalog, db.gymExercises], async () => {
    const already = await machinesAlreadyAtGym(gymId, parsed.machines);
    const fresh = parsed.machines.filter((_, i) => !already[i]);
    const needed = new Set(fresh.map((m) => m.catalogId));
    const newExercises = parsed.newExercises.filter((e) => needed.has(e.id));
    if (newExercises.length > 0) await addCustomEntries(newExercises);
    const saved: GymExercise[] = [];
    for (const m of fresh) {
      saved.push(
        await saveGymExercise({ gymId, catalogId: m.catalogId, label: m.label, notes: m.notes, loading: m.loading, hidden: false }),
      );
    }
    return saved;
  });
}

export async function deleteGymExercise(id: string): Promise<void> {
  await db.gymExercises.delete(id);
}

function byName(a: CatalogExercise | undefined, b: CatalogExercise | undefined): number {
  return (a?.name ?? '').localeCompare(b?.name ?? '');
}

/** Machine GymExercises of a gym (hidden included: the gym screen edits them), by catalogue name then label. */
export async function listGymMachines(gymId: string): Promise<GymExercise[]> {
  const [mine, catalog] = await Promise.all([db.gymExercises.where('gymId').equals(gymId).toArray(), getCatalog()]);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  return mine
    .filter((ge) => byId.get(ge.catalogId)?.kind === 'machine')
    .sort((a, b) => byName(byId.get(a.catalogId), byId.get(b.catalogId)) || a.label.localeCompare(b.label));
}

// ---- picker ----

function itemFor(entry: CatalogExercise, ge: GymExercise | null): PickerItem {
  const loading = ge ? ge.loading : entry.defaultLoading!;
  return {
    key: ge ? ge.id : 'c:' + entry.id,
    catalogId: entry.id,
    gymExerciseId: ge ? ge.id : null,
    name: entry.name,
    label: ge ? ge.label : '',
    category: entry.category,
    loading: structuredClone(loading),
    unilateral: !!entry.unilateral,
    assisted: !!entry.assisted,
  };
}

const isFreeLike = (e: CatalogExercise) => e.kind === 'free' || e.kind === 'bodyweight';

export async function availableExercises(gymId: string, catalog: CatalogExercise[]): Promise<PickerItem[]> {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const mine = await db.gymExercises.where('gymId').equals(gymId).toArray();

  const items = new Map<string, PickerItem>();
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
 */
export async function resolveItem(gymId: string, key: string, catalog: CatalogExercise[]): Promise<PickerItem | null> {
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
