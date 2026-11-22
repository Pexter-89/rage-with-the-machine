import Dexie from 'dexie';

/** @typedef {import('../domain/types.js').Gym} Gym */
/** @typedef {import('../domain/types.js').CatalogExercise} CatalogExercise */
/** @typedef {import('../domain/types.js').GymExercise} GymExercise */
/** @typedef {import('../domain/types.js').Session} Session */
/** @typedef {import('../domain/types.js').SetEntry} SetEntry */

/**
 * The local working store. Dexie adds one property per table declared in `stores()` below:
 * `gyms` (Gym), `customCatalog` (CatalogExercise), `gymExercises` (GymExercise), `sessions` (Session),
 * `sets` (SetEntry) and `kv` ({ key, value }: settings and other small values).
 * Every table mirrors a collection of the artifact db (see cloudSync.js).
 */
export class RwtmDB extends Dexie {
  /**
   * `options` lets the app fall back to an in-memory IndexedDB (fake-indexeddb) when the frame refuses IndexedDB.
   * @param {{ indexedDB: IDBFactory, IDBKeyRange: typeof IDBKeyRange }} [options]
   */
  constructor(options) {
    super('rwtm', options);
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
export let db = new RwtmDB();

/**
 * When another tab opens a newer schema, let go of this connection and reload onto it,
 * so an old tab never blocks the upgrade.
 * @param {RwtmDB} [database=db]
 * @param {() => void} [reload=() => location.reload()]
 */
export function closeOnVersionChange(database = db, reload = () => location.reload()) {
  database.on('versionchange', () => {
    database.close();
    reload();
  });
}

/**
 * Swaps the live database (main.js uses it for its in-memory fallback). Call before anything opens it.
 * @param {RwtmDB} next
 */
export function setDb(next) {
  db.close();
  db = next;
}

/**
 * Tests: close and delete the current database, then open a fresh one.
 * @returns {Promise<void>}
 */
export async function resetDb() {
  db.close();
  await db.delete();
  db = new RwtmDB();
  await db.open();
}
