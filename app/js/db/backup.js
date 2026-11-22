import { CATEGORIES } from '../domain/catalog.js';
import { getCatalog } from './catalogRepo.js';
import { db } from './db.js';
import { getSettings } from './settingsRepo.js';

/**
 * @typedef {object} BackupFile
 * @property {'rwtm-backup'} format
 * @property {1} version
 * @property {number} exportedAt
 * @property {{ gyms: Gym[], customCatalog: CatalogExercise[], gymExercises: GymExercise[], sessions: Session[], sets: SetEntry[], settings: Settings }} data
 */

const TABLE_KEYS = ['gyms', 'customCatalog', 'gymExercises', 'sessions', 'sets'];
const SETTINGS_KEY = 'settings';

/**
 * @param {number} now
 * @returns {Promise<BackupFile>}
 */
export async function exportBackup(now) {
  return db.transaction('r', [db.gyms, db.customCatalog, db.gymExercises, db.sessions, db.sets, db.kv], async () => ({
    format: 'rwtm-backup',
    version: 1,
    exportedAt: now,
    data: {
      gyms: await db.gyms.toArray(),
      customCatalog: await db.customCatalog.toArray(),
      gymExercises: await db.gymExercises.toArray(),
      sessions: await db.sessions.toArray(),
      sets: await db.sets.toArray(),
      settings: await getSettings(),
    },
  }));
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  if (!isObject(data.settings)) return { ok: false, error: 'Backup is missing its settings.' };
  return { ok: true, file: json };
}

/**
 * One transaction: clear every table, then add. Any failure aborts and keeps the previous data.
 * @param {BackupFile} file
 * @returns {Promise<void>}
 */
export async function restoreBackup(file) {
  const { data } = file;
  await db.transaction('rw', [db.gyms, db.customCatalog, db.gymExercises, db.sessions, db.sets, db.kv], async () => {
    await Promise.all([db.gyms, db.customCatalog, db.gymExercises, db.sessions, db.sets, db.kv].map((t) => t.clear()));
    await db.gyms.bulkAdd(data.gyms);
    await db.customCatalog.bulkAdd(data.customCatalog);
    await db.gymExercises.bulkAdd(data.gymExercises);
    await db.sessions.bulkAdd(data.sessions);
    await db.sets.bulkAdd(data.sets);
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
