import 'fake-indexeddb/auto';
import { db, resetDb } from '../../app/js/db/db.js';
import { addDemoData, hasDemoData, removeDemoData } from '../../app/js/db/demo.js';
import { addGym } from '../../app/js/db/gymRepo.js';
import { addSet, startSession } from '../../app/js/db/sessionRepo.js';
import { availableExercises } from '../../app/js/db/gymRepo.js';
import { getCatalog } from '../../app/js/db/catalogRepo.js';

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
  expect((await db.gyms.orderBy('order').toArray()).map((g) => g.name)).toEqual([
    'Kamppi',
    'Demo · City Gym',
    'Demo · Home Gym',
  ]);
  const sessions = (await db.sessions.toArray()).filter((x) => x.id !== s.id);
  expect(sessions).toHaveLength(n);
  expect(sessions.every((x) => x.endedAt !== null && x.endedAt < NOW)).toBe(true);
  const sets = await db.sets.where('gymId').startsWith('demo-').toArray();
  expect(new Set(sets.map((x) => x.catalogId)).size).toBeGreaterThanOrEqual(12);
  // Squats progress over the months.
  const squat = sets.filter((x) => x.catalogId === 'barbell-back-squat').sort((a, b) => a.completedAt - b.completedAt);
  expect(squat.at(-1).weight).toBeGreaterThan(squat[0].weight + 20);

  // Two demo programs; the City gym's sessions were done with them.
  const programs = await db.programs.orderBy('order').toArray();
  expect(programs.map((p) => p.name)).toEqual(['Demo · Day A', 'Demo · Day B']);
  expect(programs[0].items[0]).toEqual({ catalogId: 'barbell-back-squat', sets: 4, reps: 8 });
  expect(programs[0].items[1].catalogId).toBe('leg-press');
  const withPlan = sessions.filter((x) => x.programId);
  expect(withPlan.length).toBeGreaterThan(20);
  expect(withPlan.every((x) => x.gymId === 'demo-gym-city' && x.plan.length > 0)).toBe(true);
  await db.programs.add({ id: 'mine', name: 'Mine', order: 9, archived: false, items: [], createdAt: 0, updatedAt: 0 });

  // Loading again replaces rather than duplicates.
  await addDemoData(NOW);
  expect(await db.sessions.count()).toBe(n + 1);
  expect(await db.programs.count()).toBe(3);

  await removeDemoData();
  expect(await hasDemoData()).toBe(false);
  expect((await db.gyms.toArray()).map((g) => g.id)).toEqual([mine.id]);
  expect(await db.sessions.count()).toBe(1);
  expect(await db.sets.count()).toBe(1);
  expect(await db.gymExercises.where('gymId').startsWith('demo-').count()).toBe(0);
  expect((await db.programs.toArray()).map((p) => p.id)).toEqual(['mine']);
}, 20_000); // thousands of rows are slow in fake-indexeddb under a full parallel run
