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

/** Tests: close and delete the current database, then open a fresh one. */
export async function resetDb(): Promise<void> {
  db.close();
  await db.delete();
  db = new RwtmDB();
  await db.open();
}
