import { CATEGORIES } from '../domain/catalog.js';
import { getCatalog } from './catalogRepo.js';
import { db } from './db.js';
import { getSettings } from './settingsRepo.js';

/**
 * @typedef {object} BackupFile
 * @property {'rwtm-backup'} format
 * @property {1} version
 * @property {number} exportedAt
 * @property {{ gyms: Gym[], customCatalog: CatalogExercise[], gymExercises: GymExercise[], sessions: Session[], sets: SetEntry[], programs?: Program[], settings: Settings }} data
 *   `programs` is absent in backups from before programs; such a backup restores with no programs.
 */

const TABLE_KEYS = ['gyms', 'customCatalog', 'gymExercises', 'sessions', 'sets'];
/** Lists added after the first backups: optional when reading, always written. */
const OPTIONAL_KEYS = ['programs'];
const SETTINGS_KEY = 'settings';

/**
 * @param {number} now
 * @returns {Promise<BackupFile>}
 */
export async function exportBackup(now) {
  return db.transaction('r', [db.gyms, db.customCatalog, db.gymExercises, db.sessions, db.sets, db.programs, db.kv], async () => ({
    format: 'rwtm-backup',
    version: 1,
    exportedAt: now,
    data: {
      gyms: await db.gyms.toArray(),
      customCatalog: await db.customCatalog.toArray(),
      gymExercises: await db.gymExercises.toArray(),
      sessions: await db.sessions.toArray(),
      sets: await db.sets.toArray(),
      programs: await db.programs.toArray(),
      settings: await getSettings(),
    },
  }));
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} v */
const isPosInt = (v) => Number.isInteger(v) && /** @type {number} */ (v) > 0;

/** @param {unknown} p */
const isValidProgram = (p) =>
  isObject(p) &&
  typeof p.id === 'string' &&
  typeof p.name === 'string' &&
  Array.isArray(p.items) &&
  p.items.every((i) => isObject(i) && typeof i.catalogId === 'string' && isPosInt(i.sets) && isPosInt(i.reps));

/**
 * @param {unknown} json
 * @returns {{ ok: true, file: BackupFile } | { ok: false, error: string }}
 */
export function validateBackup(json) {
  if (!isObject(json) || json.format !== 'rwtm-backup')
    return { ok: false, error: 'Not a Rage with the machine backup file.' };
  if (json.version !== 1) return { ok: false, error: `Unsupported backup version: ${String(json.version)}.` };
  const data = json.data;
  if (!isObject(data)) return { ok: false, error: 'Backup is missing its data.' };
  for (const key of TABLE_KEYS) {
    if (!Array.isArray(data[key])) return { ok: false, error: `Backup is missing the "${key}" list.` };
  }
  for (const key of OPTIONAL_KEYS) {
    if (data[key] !== undefined && !Array.isArray(data[key]))
      return { ok: false, error: `Backup's "${key}" is not a list.` };
  }
  if (Array.isArray(data.programs)) {
    for (const p of data.programs) {
      if (!isValidProgram(p)) return { ok: false, error: 'Backup has an invalid program.' };
    }
  }
  if (!isObject(data.settings)) return { ok: false, error: 'Backup is missing its settings.' };
  return { ok: true, file: json };
}

/**
 * One transaction: clear every table, then add. Any failure aborts and keeps the previous data. A backup
 * without `programs` (older than programs) leaves no programs, as it does for every other table.
 * @param {BackupFile} file
 * @returns {Promise<void>}
 */
export async function restoreBackup(file) {
  const { data } = file;
  const tables = [db.gyms, db.customCatalog, db.gymExercises, db.sessions, db.sets, db.programs, db.kv];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await db.gyms.bulkAdd(data.gyms);
    await db.customCatalog.bulkAdd(data.customCatalog);
    await db.gymExercises.bulkAdd(data.gymExercises);
    await db.sessions.bulkAdd(data.sessions);
    await db.sets.bulkAdd(data.sets);
    await db.programs.bulkAdd(data.programs ?? []);
    await db.kv.put({ key: SETTINGS_KEY, value: data.settings });
  });
}

/** @returns {Promise<CsvRow[]>} */
export async function buildCsvRows() {
  const [sets, gyms, catalog, machines, sessions] = await Promise.all([
    db.sets.orderBy('completedAt').toArray(),
    db.gyms.toArray(),
    getCatalog(),
    db.gymExercises.toArray(),
    db.sessions.toArray(),
  ]);
  const bodyweight = new Map(sessions.map((s) => [s.id, s.bodyweight ?? null]));
  const gymName = new Map(gyms.map((g) => [g.id, g.name]));
  const entry = new Map(catalog.map((c) => [c.id, c]));
  const label = new Map(machines.map((m) => [m.id, m.label]));
  const categoryName = new Map(CATEGORIES.map((c) => [c.id, c.name]));
  return sets.map((s) => {
    const c = entry.get(s.catalogId);
    return {
      completedAt: s.completedAt,
      gym: gymName.get(s.gymId) ?? '',
      exercise: c?.name ?? s.catalogId,
      category: c ? (categoryName.get(c.category) ?? c.category) : '',
      machine: s.gymExerciseId ? (label.get(s.gymExerciseId) ?? '') : '',
      setNo: s.order,
      weight: s.weight,
      reps: s.reps,
      unit: s.unit,
      baseWeight: s.baseWeight,
      kind: c?.kind,
      assisted: c?.assisted ?? false,
      bodyweight: bodyweight.get(s.sessionId) ?? null,
    };
  });
}
