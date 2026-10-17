import { beforeEach, expect, test } from 'vitest';
import { resetDb } from './db';
import { addCustomEntries, getCatalog } from './catalogRepo';
import { BUILT_IN_CATALOG } from '../domain/catalog';
import type { CatalogExercise } from '../domain/types';

beforeEach(resetDb);

const custom: CatalogExercise = { id: 'custom-1', name: 'Custom', category: 'core', kind: 'machine', builtIn: false };

test('getCatalog returns built-in plus custom', async () => {
  await addCustomEntries([custom]);
  const cat = await getCatalog();
  expect(cat).toHaveLength(BUILT_IN_CATALOG.length + 1);
  expect(cat.some((e) => e.id === 'custom-1')).toBe(true);
});

test('addCustomEntries rejects an id that already exists', async () => {
  await expect(addCustomEntries([{ ...custom, id: 'leg-press' }])).rejects.toThrow(/leg-press/);
  await addCustomEntries([custom]);
  await expect(addCustomEntries([custom])).rejects.toThrow(/custom-1/);
});

test('addCustomEntries is all-or-nothing', async () => {
  await expect(addCustomEntries([custom, { ...custom, id: 'leg-press' }])).rejects.toThrow();
  expect((await getCatalog()).some((e) => e.id === 'custom-1')).toBe(false);
});
