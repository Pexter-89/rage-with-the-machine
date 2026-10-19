import 'fake-indexeddb/auto';
import { db, resetDb } from './db';
import { addDemoData, hasDemoData, removeDemoData } from './demo';
import { addGym } from './gymRepo';
import { addSet, startSession } from './sessionRepo';
import { availableExercises } from './gymRepo';
import { getCatalog } from './catalogRepo';

beforeEach(resetDb);

const NOW = new Date(2026, 9, 19, 12).getTime();

test('demo data adds two gyms with months of ended sessions, and is removed without touching real data', async () => {
  const mine = await addGym('Kamppi');
  const s = await startSession(mine.id, NOW);
  const item = (await availableExercises(mine.id, await getCatalog()))[0];
  await addSet(s.id, item, 20, 5, NOW);

  const n = await addDemoData(NOW);
  expect(n).toBeGreaterThan(40);
  expect(await hasDemoData()).toBe(true);
  expect((await db.gyms.orderBy('order').toArray()).map((g) => g.name)).toEqual(['Kamppi', 'Demo · City Gym', 'Demo · Home Gym']);
  const sessions = (await db.sessions.toArray()).filter((x) => x.id !== s.id);
  expect(sessions).toHaveLength(n);
  expect(sessions.every((x) => x.endedAt !== null && x.endedAt < NOW)).toBe(true);
  const sets = await db.sets.where('gymId').startsWith('demo-').toArray();
  expect(new Set(sets.map((x) => x.catalogId)).size).toBeGreaterThanOrEqual(12);
  // Squats progress over the months.
  const squat = sets.filter((x) => x.catalogId === 'barbell-back-squat').sort((a, b) => a.completedAt - b.completedAt);
  expect(squat.at(-1)!.weight).toBeGreaterThan(squat[0].weight + 20);

  // Loading again replaces rather than duplicates.
  await addDemoData(NOW);
  expect(await db.sessions.count()).toBe(n + 1);

  await removeDemoData();
  expect(await hasDemoData()).toBe(false);
  expect((await db.gyms.toArray()).map((g) => g.id)).toEqual([mine.id]);
  expect(await db.sessions.count()).toBe(1);
  expect(await db.sets.count()).toBe(1);
  expect(await db.gymExercises.where('gymId').startsWith('demo-').count()).toBe(0);
}, 20_000); // thousands of rows are slow in fake-indexeddb under a full parallel run
