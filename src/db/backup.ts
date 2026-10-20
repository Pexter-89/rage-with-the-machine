import { CATEGORIES } from '../domain/catalog';
import type { CsvRow } from '../domain/csv';
import type { CatalogExercise, Gym, GymExercise, Session, SetEntry, Settings } from '../domain/types';
import { getCatalog } from './catalogRepo';
import { db } from './db';
import { getSettings } from './settingsRepo';

export interface BackupFile {
  format: 'rwtm-backup';
  version: 1;
  exportedAt: number;
  data: {
    gyms: Gym[];
    customCatalog: CatalogExercise[];
    gymExercises: GymExercise[];
    sessions: Session[];
    sets: SetEntry[];
    settings: Settings;
  };
}

const TABLE_KEYS = ['gyms', 'customCatalog', 'gymExercises', 'sessions', 'sets'] as const;
const SETTINGS_KEY = 'settings';

export async function exportBackup(now: number): Promise<BackupFile> {
  return db.transaction('r', [db.gyms, db.customCatalog, db.gymExercises, db.sessions, db.sets, db.kv], async () => ({
    format: 'rwtm-backup' as const,
    version: 1 as const,
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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateBackup(json: unknown): { ok: true; file: BackupFile } | { ok: false; error: string } {
  if (!isObject(json) || json.format !== 'rwtm-backup') return { ok: false, error: 'Not a Rage with the machine backup file.' };
  if (json.version !== 1) return { ok: false, error: `Unsupported backup version: ${String(json.version)}.` };
  const data = json.data;
  if (!isObject(data)) return { ok: false, error: 'Backup is missing its data.' };
  for (const key of TABLE_KEYS) {
    if (!Array.isArray(data[key])) return { ok: false, error: `Backup is missing the "${key}" list.` };
  }
  if (!isObject(data.settings)) return { ok: false, error: 'Backup is missing its settings.' };
  return { ok: true, file: json as unknown as BackupFile };
}

/** One transaction: clear every table, then add. Any failure aborts and keeps the previous data. */
export async function restoreBackup(file: BackupFile): Promise<void> {
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

export async function buildCsvRows(): Promise<CsvRow[]> {
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
  const categoryName = new Map(CATEGORIES.map((c) => [c.id as string, c.name]));
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
