import type { Loading } from './types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

function range(start: number, max: number, stepAt: (v: number) => number): number[] {
  const out: number[] = [];
  let v = round2(start);
  while (v <= max + 1e-9) {
    const step = stepAt(v);
    if (!(step > 0)) return [round2(start)];
    out.push(v);
    v = round2(v + step);
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  return keys.length === Object.keys(rb).length && keys.every((k) => Object.hasOwn(rb, k) && deepEqual(ra[k], rb[k]));
}

/** Deep equality of two loading definitions (key order does not matter). */
export function sameLoading(a: Loading, b: Loading): boolean {
  return deepEqual(a, b);
}

/** Ascending list of selectable weights for a loading definition. */
export function wheelValues(l: Loading): number[] {
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

/** Nearest value on the wheel; ties round up. */
export function snapToWheel(values: number[], w: number): number {
  let best = values[0];
  for (const v of values) {
    if (Math.abs(v - w) <= Math.abs(best - w)) best = v;
  }
  return best;
}

export function parseWeightInput(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function parseRepsInput(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

type PlatesLoading = Extract<Loading, { type: 'plates' }>;

/** Total weight of the bar or sled plus `plates` (one side's plates when loaded in pairs). */
export function plateTotal(l: PlatesLoading, plates: number[]): number {
  return round2(l.base + l.sides * plates.reduce((sum, p) => sum + p, 0));
}

/**
 * The plates (per side, heaviest first) that make up `total`, picking the heaviest plates first.
 * `rest` is what the available plates cannot make up (per side); 0 when the total is exact.
 */
export function platesFor(l: PlatesLoading, total: number): { plates: number[]; rest: number } {
  let left = round2((total - l.base) / l.sides);
  const plates: number[] = [];
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

/** Plates heaviest first, the way they go on the bar. */
export function sortPlates(plates: number[]): number[] {
  return [...plates].sort((a, b) => b - a);
}
