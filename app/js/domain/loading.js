/**
 * @param {number} n
 * @returns {number}
 */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {number} start
 * @param {number} max
 * @param {(v: number) => number} stepAt
 * @returns {number[]}
 */
function range(start, max, stepAt) {
  const out = [];
  let v = round2(start);
  while (v <= max + 1e-9) {
    const step = stepAt(v);
    if (!(step > 0)) return [round2(start)];
    out.push(v);
    v = round2(v + step);
  }
  return out;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a;
  const rb = b;
  const keys = Object.keys(ra);
  return keys.length === Object.keys(rb).length && keys.every((k) => Object.hasOwn(rb, k) && deepEqual(ra[k], rb[k]));
}

/**
 * Deep equality of two loading definitions (key order does not matter).
 * @param {Loading} a
 * @param {Loading} b
 * @returns {boolean}
 */
export function sameLoading(a, b) {
  return deepEqual(a, b);
}

/**
 * Ascending list of selectable weights for a loading definition.
 * @param {Loading} l
 * @returns {number[]}
 */
export function wheelValues(l) {
  switch (l.type) {
    case 'stack':
      return [...l.weights].sort((a, b) => a - b);
    case 'plate':
      return range(l.base, l.base + 400, () => l.step);
    case 'plates': {
      const smallest = Math.min(...l.plates);
      return range(l.base, l.base + 400, () => (Number.isFinite(smallest) ? smallest * l.sides : 0));
    }
    case 'free':
      return range(l.start, l.max, (v) =>
        l.bigStepFrom !== undefined && l.bigStep !== undefined && v >= l.bigStepFrom ? l.bigStep : l.step,
      );
    case 'bodyweight':
      return range(0, l.max, () => l.step);
  }
}

/**
 * Every sum of a subset of the add-ons, with the subset; the empty subset first.
 * @param {number[]} addOns
 * @returns {{ on: boolean[], sum: number }[]}
 */
export function addOnCombos(addOns) {
  const out = [];
  for (let mask = 0; mask < 1 << addOns.length; mask++) {
    const on = addOns.map((_, i) => (mask & (1 << i)) !== 0);
    out.push({ on, sum: round2(addOns.reduce((s, a, i) => s + (on[i] ? a : 0), 0)) });
  }
  return out;
}

/**
 * Which add-ons are switched in for a total of `w` on a stack: the first combination (fewest add-ons first)
 * whose remainder is a stack weight. None switched in when no combination fits.
 * @param {number[]} weights
 * @param {number[]} addOns
 * @param {number} w
 * @returns {boolean[]}
 */
export function addOnsFor(weights, addOns, w) {
  const combos = addOnCombos(addOns).sort((a, b) => a.on.filter(Boolean).length - b.on.filter(Boolean).length);
  return (combos.find((c) => weights.includes(round2(w - c.sum))) ?? combos[0]).on;
}

/**
 * Every total a loading can make: for a stack with add-ons, each stack weight plus each add-on combination.
 * @param {Loading} l
 * @returns {number[]}
 */
export function reachableValues(l) {
  if (l.type !== 'stack' || !l.addOns?.length) return wheelValues(l);
  const sums = addOnCombos(l.addOns).map((c) => c.sum);
  return [...new Set(l.weights.flatMap((w) => sums.map((s) => round2(w + s))))].sort((a, b) => a - b);
}

/**
 * Nearest value on the wheel; ties round up.
 * @param {number[]} values
 * @param {number} w
 * @returns {number}
 */
export function snapToWheel(values, w) {
  let best = values[0];
  for (const v of values) {
    if (Math.abs(v - w) <= Math.abs(best - w)) best = v;
  }
  return best;
}

/**
 * @param {string} s
 * @returns {number | null}
 */
export function parseWeightInput(s) {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * @param {string} s
 * @returns {number | null}
 */
export function parseRepsInput(s) {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** @typedef {Extract<Loading, { type: 'plates' }>} PlatesLoading */

/**
 * Total weight of the bar or sled plus `plates` (one side's plates when loaded in pairs).
 * @param {PlatesLoading} l
 * @param {number[]} plates
 * @returns {number}
 */
export function plateTotal(l, plates) {
  return round2(l.base + l.sides * plates.reduce((sum, p) => sum + p, 0));
}

/**
 * The plates (per side, heaviest first) that make up `total`, picking the heaviest plates first.
 * `rest` is what the available plates cannot make up (per side); 0 when the total is exact.
 * @param {PlatesLoading} l
 * @param {number} total
 * @returns {{ plates: number[], rest: number }}
 */
export function platesFor(l, total) {
  let left = round2((total - l.base) / l.sides);
  const plates = [];
  if (!(left > 0)) return { plates, rest: 0 };
  const sizes = [...l.plates].filter((p) => p > 0).sort((a, b) => b - a);
  for (const p of sizes) {
    while (left >= p - 1e-9) {
      plates.push(p);
      left = round2(left - p);
    }
  }
  return { plates, rest: left };
}

/**
 * Plates heaviest first, the way they go on the bar.
 * @param {number[]} plates
 * @returns {number[]}
 */
export function sortPlates(plates) {
  return [...plates].sort((a, b) => b - a);
}
