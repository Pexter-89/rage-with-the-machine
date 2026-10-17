import type { Loading } from './types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

function range(start: number, max: number, stepAt: (v: number) => number): number[] {
  const out: number[] = [];
  let v = round2(start);
  while (v <= max + 1e-9) {
    out.push(v);
    v = round2(v + stepAt(v));
  }
  return out;
}

/** Ascending list of selectable weights for a loading definition. */
export function wheelValues(l: Loading): number[] {
  switch (l.type) {
    case 'stack':
      return [...l.weights].sort((a, b) => a - b);
    case 'plate':
      return range(l.base, l.base + 400, () => l.step);
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
