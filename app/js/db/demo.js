import { BUILT_IN_CATALOG } from '../domain/catalog.js';
import { wheelValues, snapToWheel } from '../domain/loading.js';
import { db } from './db.js';

/**
 * Demo data: two gyms with about five months of made-up training and two programs, for exploring the app.
 * Every row's id starts with `demo-`, so it can be removed again without touching real data.
 */
export const DEMO_PREFIX = 'demo-';
const CITY = 'demo-gym-city';
const HOME = 'demo-gym-home';
const WEEKS = 22;

/**
 * Small deterministic PRNG, so the demo history is the same every time.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} from
 * @param {number} to
 * @param {number} step
 * @returns {Loading}
 */
const stack = (from, to, step) => ({
  type: 'stack',
  weights: Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step),
});

const MACHINES = [
  {
    id: 'demo-ge-leg-press',
    catalogId: 'leg-press',
    label: 'Demo plate-loaded leg press',
    loading: { type: 'plates', base: 62, plates: [1.25, 2.5, 5, 10, 15, 20, 25], sides: 2 },
  },
  {
    id: 'demo-ge-lat-pulldown',
    catalogId: 'lat-pulldown',
    label: 'Demo lat pulldown, +2.5 kg add-on',
    loading: { ...stack(5, 100, 5), addOns: [2.5] },
  },
  { id: 'demo-ge-seated-row', catalogId: 'seated-row', label: 'Demo seated row', loading: stack(5, 100, 5) },
  { id: 'demo-ge-leg-curl', catalogId: 'seated-leg-curl', label: 'Demo leg curl', loading: stack(5, 90, 5) },
  {
    id: 'demo-ge-pushdown',
    catalogId: 'cable-triceps-pushdown',
    label: 'Demo cable station',
    loading: stack(2.5, 50, 2.5),
  },
  {
    id: 'demo-ge-assisted-pull-up',
    catalogId: 'assisted-pull-up',
    label: 'Demo assisted pull-up',
    loading: stack(5, 70, 5),
  },
];

/**
 * @typedef {object} Plan
 * @property {string} key A gymExercise id for machines; otherwise the catalogue id of a free or bodyweight exercise.
 * @property {number} start
 * @property {number} perWeek kg gained per week (negative for assisted: less help).
 * @property {[number, number]} reps
 * @property {number} sets
 */

const DAY_A = [
  { key: 'barbell-back-squat', start: 60, perWeek: 2, reps: [5, 8], sets: 4 },
  { key: 'demo-ge-leg-press', start: 112, perWeek: 4, reps: [8, 12], sets: 3 },
  { key: 'barbell-bench-press', start: 50, perWeek: 1.25, reps: [5, 8], sets: 4 },
  { key: 'demo-ge-lat-pulldown', start: 45, perWeek: 1, reps: [8, 12], sets: 3 },
  { key: 'demo-ge-pushdown', start: 20, perWeek: 0.5, reps: [10, 15], sets: 3 },
];
const DAY_B = [
  { key: 'deadlift', start: 80, perWeek: 2.5, reps: [3, 6], sets: 3 },
  { key: 'overhead-press', start: 32.5, perWeek: 0.75, reps: [5, 8], sets: 3 },
  { key: 'demo-ge-seated-row', start: 40, perWeek: 1, reps: [8, 12], sets: 3 },
  { key: 'demo-ge-assisted-pull-up', start: 45, perWeek: -1.25, reps: [6, 10], sets: 3 },
  { key: 'demo-ge-leg-curl', start: 30, perWeek: 0.75, reps: [10, 12], sets: 3 },
  { key: 'dumbbell-curl', start: 10, perWeek: 0.25, reps: [8, 12], sets: 3 },
];
const DAY_HOME = [
  { key: 'dumbbell-bench-press', start: 16, perWeek: 0.5, reps: [8, 12], sets: 3 },
  { key: 'goblet-squat', start: 16, perWeek: 0.5, reps: [10, 15], sets: 3 },
  { key: 'one-arm-dumbbell-row', start: 18, perWeek: 0.5, reps: [8, 12], sets: 3 },
  { key: 'pull-up', start: 0, perWeek: 0, reps: [4, 9], sets: 3 },
  { key: 'band-pull-apart', start: 2, perWeek: 0.1, reps: [15, 20], sets: 2 },
];

/** The City gym's two days as programs; their sessions are logged as started from them. */
const DEMO_PROGRAMS = [
  { id: 'demo-p-a', name: 'Demo · Day A', days: DAY_A },
  { id: 'demo-p-b', name: 'Demo · Day B', days: DAY_B },
];

/**
 * @param {Plan[]} days
 * @returns {ProgramItem[]}
 */
const programItems = (days) =>
  days.map((p) => ({
    catalogId: MACHINES.find((m) => m.id === p.key)?.catalogId ?? p.key,
    sets: p.sets,
    reps: p.reps[1],
  }));

/**
 * True when the demo gyms are in the database.
 * @returns {Promise<boolean>}
 */
export async function hasDemoData() {
  return (await db.gyms.where('id').startsWith(DEMO_PREFIX).count()) > 0;
}

/**
 * Adds the demo gyms, machines and history (replacing an earlier demo). Returns the number of sessions.
 * @param {number} now
 * @returns {Promise<number>}
 */
export async function addDemoData(now) {
  const rnd = mulberry32(20261019);
  const catalog = new Map(BUILT_IN_CATALOG.map((e) => [e.id, e]));

  const machines = MACHINES.map((m) => ({ ...m, gymId: CITY, notes: '', hidden: false }));
  const byId = new Map(machines.map((m) => [m.id, m]));
  const sessions = [];
  const sets = [];

  const day = 86_400_000;
  const startDay = new Date(now - WEEKS * 7 * day);
  startDay.setHours(0, 0, 0, 0);
  let n = 0;
  let a = true;
  for (let w = 0; w < WEEKS; w++) {
    // Every sixth week is a lighter deload week.
    const deload = w % 6 === 5;
    for (const weekday of [0, 2, 4]) {
      if (rnd() < 0.12) continue; // missed sessions happen
      const atHome = weekday === 4 && rnd() < 0.45;
      const plan = atHome ? DAY_HOME : a ? DAY_A : DAY_B;
      if (!atHome) a = !a;
      const begin = startDay.getTime() + (w * 7 + weekday) * day + (17 * 60 + Math.floor(rnd() * 120)) * 60_000;
      if (begin > now - 2 * 3600_000) continue;
      const sessionId = `demo-s-${String(++n).padStart(3, '0')}`;
      const gymId = atHome ? HOME : CITY;
      let t = begin + 5 * 60_000;
      for (const p of plan) {
        const ge = byId.get(p.key);
        const entry = catalog.get(ge ? ge.catalogId : p.key);
        const loading = ge ? ge.loading : entry.defaultLoading;
        const values = wheelValues(loading);
        const target = Math.max(0, (p.start + p.perWeek * (w + rnd() * 0.6 - 0.3)) * (deload ? 0.88 : 1));
        const work = snapToWheel(values, target);
        for (let i = 0; i < p.sets; i++) {
          // A lighter first set, then working sets where reps drop as fatigue builds.
          const weight = i === 0 && p.sets > 2 ? snapToWheel(values, work * 0.85) : work;
          const [lo, hi] = p.reps;
          const reps = Math.max(
            1,
            Math.round(hi - (hi - lo) * (i / Math.max(1, p.sets - 1)) - rnd() * 1.5 + (deload ? 1 : 0)),
          );
          t += (90 + Math.floor(rnd() * 90)) * 1000;
          sets.push({
            id: `demo-x-${sessionId.slice(7)}-${sets.length}`,
            sessionId,
            gymId,
            catalogId: entry.id,
            gymExerciseId: ge ? ge.id : null,
            order: i + 1,
            weight,
            reps,
            baseWeight: loading.type === 'plate' || loading.type === 'plates' ? loading.base : null,
            unit: loading.type === 'stack' ? (loading.unit ?? 'kg') : 'kg',
            completedAt: t,
          });
        }
        t += 60_000;
      }
      const program = DEMO_PROGRAMS.find((d) => d.days === plan);
      sessions.push({
        id: sessionId,
        gymId,
        startedAt: begin,
        endedAt: t + 5 * 60_000,
        lastActivityAt: t,
        ...(program ? { programId: program.id, plan: programItems(program.days) } : {}),
      });
    }
  }

  await db.transaction('rw', [db.gyms, db.gymExercises, db.sessions, db.sets, db.programs], async () => {
    await removeDemoRows();
    const order = (await db.gyms.toArray()).reduce((m, g) => Math.max(m, g.order), -1) + 1;
    const programOrder = (await db.programs.toArray()).reduce((m, p) => Math.max(m, p.order), -1) + 1;
    await db.programs.bulkAdd(
      DEMO_PROGRAMS.map((d, i) => ({
        id: d.id,
        name: d.name,
        order: programOrder + i,
        archived: false,
        items: programItems(d.days),
        createdAt: now,
        updatedAt: now,
      })),
    );
    const gyms = [
      { id: CITY, name: 'Demo · City Gym', order, archived: false },
      { id: HOME, name: 'Demo · Home Gym', order: order + 1, archived: false },
    ];
    await db.gyms.bulkAdd(gyms);
    await db.gymExercises.bulkAdd(machines);
    await db.sessions.bulkAdd(sessions);
    await db.sets.bulkAdd(sets);
  });
  return sessions.length;
}

/** @returns {Promise<void>} */
async function removeDemoRows() {
  await db.sets.where('gymId').startsWith(DEMO_PREFIX).delete();
  await db.sessions.where('gymId').startsWith(DEMO_PREFIX).delete();
  await db.gymExercises.where('gymId').startsWith(DEMO_PREFIX).delete();
  await db.gyms.where('id').startsWith(DEMO_PREFIX).delete();
  await db.programs.where('id').startsWith(DEMO_PREFIX).delete();
}

/**
 * Removes the demo gyms, the demo programs and everything logged at the demo gyms, including sessions started
 * there by hand.
 * @returns {Promise<void>}
 */
export async function removeDemoData() {
  await db.transaction('rw', [db.gyms, db.gymExercises, db.sessions, db.sets, db.programs], removeDemoRows);
}
