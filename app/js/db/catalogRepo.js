import { BUILT_IN_CATALOG } from '../domain/catalog.js';
import { db } from './db.js';

/**
 * Built-in entries followed by custom (imported) entries.
 * @returns {Promise<CatalogExercise[]>}
 */
export async function getCatalog() {
  const custom = await db.customCatalog.toArray();
  return [...BUILT_IN_CATALOG, ...custom];
}

/**
 * All-or-nothing: throws, adding nothing, if any id collides with an existing or duplicate entry.
 * @param {CatalogExercise[]} entries
 * @returns {Promise<void>}
 */
export async function addCustomEntries(entries) {
  await db.transaction('rw', db.customCatalog, async () => {
    const taken = new Set(BUILT_IN_CATALOG.map((e) => e.id));
    for (const id of await db.customCatalog.toCollection().primaryKeys()) taken.add(id);
    for (const e of entries) {
      if (taken.has(e.id)) throw new Error(`Catalogue id already exists: ${e.id}`);
      taken.add(e.id);
    }
    await db.customCatalog.bulkAdd(entries);
  });
}
