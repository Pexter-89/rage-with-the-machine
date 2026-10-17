import { BUILT_IN_CATALOG } from '../domain/catalog';
import type { CatalogExercise } from '../domain/types';
import { db } from './db';

/** Built-in entries followed by custom (imported) entries. */
export async function getCatalog(): Promise<CatalogExercise[]> {
  const custom = await db.customCatalog.toArray();
  return [...BUILT_IN_CATALOG, ...custom];
}

/** All-or-nothing: throws, adding nothing, if any id collides with an existing or duplicate entry. */
export async function addCustomEntries(entries: CatalogExercise[]): Promise<void> {
  await db.transaction('rw', db.customCatalog, async () => {
    const taken = new Set<string>(BUILT_IN_CATALOG.map((e) => e.id));
    for (const id of await db.customCatalog.toCollection().primaryKeys()) taken.add(id);
    for (const e of entries) {
      if (taken.has(e.id)) throw new Error(`Catalogue id already exists: ${e.id}`);
      taken.add(e.id);
    }
    await db.customCatalog.bulkAdd(entries);
  });
}
