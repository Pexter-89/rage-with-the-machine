// Gym programs: pure logic, no database. A program is a gym-independent list of catalogue exercises with
// target sets × reps; at a gym each item resolves to one of that gym's machines (or a free/bodyweight item).

/** @typedef {import('./types.js').CatalogExercise} CatalogExercise */
/** @typedef {import('./types.js').GymExercise} GymExercise */
/** @typedef {import('./types.js').SetEntry} SetEntry */
/** @typedef {import('./types.js').ProgramItem} ProgramItem */

export const MIN_SETS = 1;
export const MAX_SETS = 20;
export const MIN_REPS = 1;
export const MAX_REPS = 50;

/**
 * @typedef {object} Availability
 * @property {'available' | 'choose' | 'missing'} status `choose`: several machines here and none used yet.
 * @property {string | null} key The picker/logging key when available (a gymExerciseId, or `c:<catalogId>`).
 * @property {GymExercise[]} machines This gym's visible machines for the exercise (machine exercises only).
 */

/** @param {CatalogExercise} e */
const isFreeLike = (e) => e.kind === 'free' || e.kind === 'bodyweight';

/**
 * Whether an exercise can be done at a gym, judged like the exercise picker does: a machine exercise needs a
 * visible machine there; a free-weight or bodyweight exercise is available unless the gym hides it ("Hide
 * here"), and uses the gym's own setting for it when there is one.
 * @param {CatalogExercise | undefined} entry
 * @param {GymExercise[]} mine Every GymExercise of the gym (hidden included).
 * @returns {Availability}
 */
export function availabilityAt(entry, mine) {
  if (!entry) return { status: 'missing', key: null, machines: [] };
  const own = mine.filter((ge) => ge.catalogId === entry.id);
  // A free/bodyweight exercise with no entry here at all uses the catalogue's default setting, like the picker.
  if (own.length === 0)
    return isFreeLike(entry) && entry.defaultLoading
      ? { status: 'available', key: 'c:' + entry.id, machines: [] }
      : missing();
  // A gym may hold several entries for one exercise (removed ones with history stay hidden).
  const machines = own.filter((ge) => !ge.hidden).sort((a, b) => a.label.localeCompare(b.label));
  if (machines.length === 0) return missing();
  if (machines.length === 1) return { status: 'available', key: machines[0].id, machines: isFreeLike(entry) ? [] : machines };
  return { status: 'choose', key: null, machines };
}

/** @returns {Availability} */
const missing = () => ({ status: 'missing', key: null, machines: [] });

/**
 * The machine last used for an exercise at a gym: the gymExerciseId of the latest set with one.
 * @param {SetEntry[]} sets Any sets; only those of `catalogId` at `gymId` count.
 * @param {string} catalogId
 * @param {string} gymId
 * @returns {string | null}
 */
export function lastUsedMachine(sets, catalogId, gymId) {
  let best = null;
  for (const s of sets) {
    if (s.catalogId !== catalogId || s.gymId !== gymId || !s.gymExerciseId) continue;
    if (!best || s.completedAt > best.completedAt) best = s;
  }
  return best?.gymExerciseId ?? null;
}

/**
 * Availability with the machine choice made: with several machines, the one last used here wins; only when
 * none of them was used yet does the status stay `choose` (the app then asks once; logging a set on the
 * chosen machine makes it the last used).
 * @param {CatalogExercise | undefined} entry
 * @param {GymExercise[]} mine
 * @param {SetEntry[]} sets Sets of this exercise (any gym); the current session's count too.
 * @param {string} gymId
 * @returns {Availability}
 */
export function resolveAt(entry, mine, sets, gymId) {
  const a = availabilityAt(entry, mine);
  if (a.status !== 'choose' || !entry) return a;
  const last = lastUsedMachine(sets, entry.id, gymId);
  return a.machines.some((m) => m.id === last) ? { ...a, status: 'available', key: last } : a;
}

/**
 * How many of a program's exercises a gym lacks.
 * @param {ProgramItem[]} items
 * @param {Map<string, CatalogExercise>} byId
 * @param {GymExercise[]} mine
 * @returns {{ count: number, missing: number }}
 */
export function programAvailability(items, byId, mine) {
  const missingCount = items.filter((i) => availabilityAt(byId.get(i.catalogId), mine).status === 'missing').length;
  return { count: items.length, missing: missingCount };
}

/**
 * What a missing exercise can be swapped for here: exercises of the same category that this gym has (its
 * machines plus free-weight and bodyweight exercises), without the exercise itself or ones in `exclude`
 * (the rest of the plan). Machines first, then by name.
 * @param {CatalogExercise} entry
 * @param {CatalogExercise[]} catalog
 * @param {GymExercise[]} mine
 * @param {Iterable<string>} [exclude=[]]
 * @returns {CatalogExercise[]}
 */
export function swapAlternatives(entry, catalog, mine, exclude = []) {
  const skip = new Set(exclude);
  skip.add(entry.id);
  return catalog
    .filter((e) => e.category === entry.category && !skip.has(e.id))
    .filter((e) => availabilityAt(e, mine).status !== 'missing')
    .sort((a, b) => Number(isFreeLike(a)) - Number(isFreeLike(b)) || a.name.localeCompare(b.name));
}

/**
 * Logged sets per plan item and whether it is done (logged ≥ target). Sets count by exercise, whichever
 * machine they were on; when the plan lists an exercise twice, its sets fill the first item first.
 * @param {ProgramItem[]} plan
 * @param {SetEntry[]} sets The session's sets.
 * @returns {{ done: number, ticked: boolean }[]}
 */
export function planProgress(plan, sets) {
  const left = new Map();
  for (const s of sets) left.set(s.catalogId, (left.get(s.catalogId) ?? 0) + 1);
  const lastIndex = new Map(plan.map((p, i) => [p.catalogId, i]));
  return plan.map((p, i) => {
    const have = left.get(p.catalogId) ?? 0;
    // The last item of an exercise takes whatever is left over, so extra sets still show.
    const done = lastIndex.get(p.catalogId) === i ? have : Math.min(have, p.sets);
    left.set(p.catalogId, have - done);
    return { done, ticked: done >= p.sets };
  });
}

/**
 * The plan item for an exercise (the first not yet done, else the first), or null when it is not planned.
 * @param {ProgramItem[] | undefined | null} plan
 * @param {string} catalogId
 * @param {SetEntry[]} [sets=[]] The session's sets, to pick between repeats.
 * @returns {ProgramItem | null}
 */
export function planItemFor(plan, catalogId, sets = []) {
  if (!plan) return null;
  const progress = planProgress(plan, sets);
  const hits = plan.map((p, i) => ({ p, i })).filter(({ p }) => p.catalogId === catalogId);
  if (hits.length === 0) return null;
  return (hits.find(({ i }) => !progress[i].ticked) ?? hits[0]).p;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/**
 * A program item with sets and reps inside the steppers' range.
 * @param {ProgramItem} item
 * @returns {ProgramItem}
 */
export function clampItem(item) {
  return {
    catalogId: item.catalogId,
    sets: clamp(item.sets, MIN_SETS, MAX_SETS),
    reps: clamp(item.reps, MIN_REPS, MAX_REPS),
  };
}

/**
 * A session as program items: exercises in the order first logged; sets = how many sets were logged;
 * reps = the median reps of those sets, rounded.
 * @param {SetEntry[]} sets
 * @returns {ProgramItem[]}
 */
export function programFromSets(sets) {
  const groups = new Map();
  const ordered = [...sets].sort((a, b) => a.completedAt - b.completedAt || a.order - b.order);
  for (const s of ordered) {
    const g = groups.get(s.catalogId);
    if (g) g.push(s.reps);
    else groups.set(s.catalogId, [s.reps]);
  }
  return [...groups].map(([catalogId, reps]) =>
    clampItem({ catalogId, sets: reps.length, reps: Math.round(median(reps)) }),
  );
}

/**
 * @param {Pick<ProgramItem, 'sets' | 'reps'>} item
 * @returns {string}
 */
export const formatTarget = (item) => `${item.sets} × ${item.reps}`;
