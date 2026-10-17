import { CATEGORIES } from './catalog';
import type { CatalogExercise, Category, Loading } from './types';

export interface ParsedMachine {
  catalogId: string;
  label: string;
  notes: string;
  loading: Loading;
}

export type ParseResult =
  | { ok: true; machines: ParsedMachine[]; newExercises: CatalogExercise[] }
  | { ok: false; error: string };

const MAX_STACK_WEIGHTS = 200;
const MIN_PLATE_STEP = 0.25;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Returns the end index (inclusive) of the object starting at `start`, skipping string literals; -1 if unbalanced. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** First JSON object with `format === 'rwtm-machine'` found anywhere in the text, or null. */
export function extractMachineJson(text: string): unknown | null {
  const src = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  for (let i = src.indexOf('{'); i !== -1; i = src.indexOf('{', i + 1)) {
    const end = matchingBrace(src, i);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(src.slice(i, end + 1));
      if (isRecord(value) && value.format === 'rwtm-machine') return value;
    } catch {
      // not JSON; try the next brace
    }
  }
  return null;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Invalid extends Error {}
const fail = (msg: string): never => {
  throw new Invalid(msg);
};

function unknownField(obj: Rec, allowed: string[], what: string): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`unknown ${what}field "${k}"`);
}

function parseNewExercise(v: unknown): CatalogExercise {
  if (!isRecord(v)) return fail('newExercise must be an object or null');
  unknownField(v, ['id', 'name', 'category', 'kind'], 'newExercise ');
  if (typeof v.id !== 'string' || !KEBAB.test(v.id)) fail('newExercise id must be kebab-case (lowercase letters, digits, hyphens)');
  if (typeof v.name !== 'string' || !v.name.trim()) fail('newExercise name must be a non-empty string');
  if (!CATEGORIES.some((c) => c.id === v.category)) {
    fail(`newExercise category must be one of ${CATEGORIES.map((c) => c.id).join(', ')}`);
  }
  if (v.kind !== 'machine') fail('newExercise kind must be "machine"');
  return {
    id: v.id as string,
    name: (v.name as string).trim(),
    category: v.category as Category,
    kind: 'machine',
    builtIn: false,
  };
}

function parseLoading(v: unknown): Loading {
  if (!isRecord(v)) return fail('loading is required and must be an object');
  if (v.type === 'stack') {
    unknownField(v, ['type', 'weights', 'unit'], 'loading ');
    const w = v.weights;
    if (!Array.isArray(w) || w.length === 0) return fail('stack weights must be a non-empty array');
    if (w.length > MAX_STACK_WEIGHTS) return fail(`stack weights may have at most ${MAX_STACK_WEIGHTS} values`);
    if (!w.every((x) => isNum(x) && x > 0)) return fail('stack weights must be positive numbers');
    const weights = [...(w as number[])].sort((a, b) => a - b);
    if (weights.some((x, i) => i > 0 && x === weights[i - 1])) return fail('stack weights must not contain duplicates');
    if (v.unit !== undefined && v.unit !== 'kg' && v.unit !== 'level') return fail('stack unit must be "kg" or "level"');
    return v.unit === undefined ? { type: 'stack', weights } : { type: 'stack', weights, unit: v.unit };
  }
  if (v.type === 'plate') {
    unknownField(v, ['type', 'base', 'step'], 'loading ');
    if (!isNum(v.base) || v.base < 0) return fail('plate base must be a number of 0 or more');
    if (!isNum(v.step) || v.step < MIN_PLATE_STEP) return fail(`plate step must be at least ${MIN_PLATE_STEP}`);
    return { type: 'plate', base: v.base, step: v.step };
  }
  return fail('loading type must be "stack" or "plate"');
}

function parseMachine(
  m: unknown,
  known: Set<string>,
  declared: Map<string, CatalogExercise>,
): { machine: ParsedMachine; newExercise: CatalogExercise | null } {
  if (!isRecord(m)) return fail('must be an object');
  unknownField(m, ['exercise', 'newExercise', 'label', 'loading', 'notes'], '');
  if (typeof m.exercise !== 'string' || !m.exercise) return fail('exercise must be a catalogue id');
  if (m.label !== undefined && typeof m.label !== 'string') return fail('label must be a string');
  if (m.notes !== undefined && typeof m.notes !== 'string') return fail('notes must be a string');

  let newExercise: CatalogExercise | null = null;
  if (m.newExercise !== undefined && m.newExercise !== null) {
    newExercise = parseNewExercise(m.newExercise);
    if (known.has(newExercise.id)) return fail(`newExercise id "${newExercise.id}" already exists in the catalogue`);
    if (m.exercise !== newExercise.id) return fail('exercise must equal newExercise id when newExercise is given');
    const earlier = declared.get(newExercise.id);
    if (earlier && JSON.stringify(earlier) !== JSON.stringify(newExercise)) {
      return fail(`newExercise "${newExercise.id}" is defined differently elsewhere in the file`);
    }
  } else if (!known.has(m.exercise)) {
    return fail(`unknown exercise "${m.exercise}"`);
  }

  return {
    machine: {
      catalogId: m.exercise,
      label: (m.label as string | undefined) ?? '',
      notes: (m.notes as string | undefined) ?? '',
      loading: parseLoading(m.loading),
    },
    newExercise,
  };
}

export function parseMachineFile(text: string, catalog: CatalogExercise[]): ParseResult {
  const root = extractMachineJson(text);
  if (!isRecord(root)) return { ok: false, error: 'No machine file found: expected JSON with "format": "rwtm-machine"' };
  if (root.version !== 1) return { ok: false, error: 'Unsupported file version (expected "version": 1)' };
  if (!Array.isArray(root.machines) || root.machines.length === 0) {
    return { ok: false, error: '"machines" must be a non-empty array' };
  }

  const known = new Set(catalog.map((e) => e.id));
  const declared = new Map<string, CatalogExercise>();
  const machines: ParsedMachine[] = [];
  for (let i = 0; i < root.machines.length; i++) {
    try {
      const { machine, newExercise } = parseMachine(root.machines[i], known, declared);
      machines.push(machine);
      if (newExercise && !declared.has(newExercise.id)) declared.set(newExercise.id, newExercise);
    } catch (e) {
      if (e instanceof Invalid) return { ok: false, error: `Machine ${i + 1}: ${e.message}` };
      throw e;
    }
  }
  return { ok: true, machines, newExercises: [...declared.values()] };
}
