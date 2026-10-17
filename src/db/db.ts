import Dexie, { type Table } from 'dexie';
import type { CatalogExercise, Gym, GymExercise, Session, SetEntry } from '../domain/types';

export class RwtmDB extends Dexie {
  gyms!: Table<Gym, string>;
  customCatalog!: Table<CatalogExercise, string>;
  gymExercises!: Table<GymExercise, string>;
  sessions!: Table<Session, string>;
  sets!: Table<SetEntry, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('rwtm');
    // Schema versioning rules:
    // - Never edit the version(1) stores below; users' devices already hold that schema.
    // - To change the schema, add `this.version(n).stores({...}).upgrade(tx => ...)` with the next n.
    // - Backups are written at backup format version 1; future app versions must still accept v1 backups.
    this.version(1).stores({
      gyms: 'id,order',
      customCatalog: 'id',
      gymExercises: 'id,gymId,catalogId',
      sessions: 'id,gymId,startedAt,endedAt',
      sets: 'id,sessionId,catalogId,gymId,gymExerciseId,completedAt',
      kv: 'key',
    });
  }
}

// Live binding: other modules must `import { db }` and never cache it.
export let db: RwtmDB = new RwtmDB();

/**
 * When another tab or the installed PWA opens a newer schema, let go of this connection and reload onto it,
 * so an old tab never blocks the upgrade.
 */
export function closeOnVersionChange(database: RwtmDB = db, reload: () => void = () => location.reload()): void {
  database.on('versionchange', () => {
    database.close();
    reload();
  });
}

/** Tests: close and delete the current database, then open a fresh one. */
export async function resetDb(): Promise<void> {
  db.close();
  await db.delete();
  db = new RwtmDB();
  await db.open();
}
