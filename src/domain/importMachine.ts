import { CATEGORIES } from './catalog';
import type { CatalogExercise, Category, Kind, Loading } from './types';

export interface ParsedMachine {
  catalogId: string;
  label: string;
  notes: string;
  loading: Loading;
  /** Hidden at the gym (exported gym files keep this; Claude's machine files leave it out). */
  hidden?: boolean;
}

export type ParseResult =
  | { ok: true; machines: ParsedMachine[]; newExercises: CatalogExercise[] }
  | { ok: false; error: string };

const MAX_STACK_WEIGHTS = 200;
const MAX_PLATE_SIZES = 20;
const MAX_ADD_ONS = 3;
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

/** Every top-level JSON object with `format === 'rwtm-machine'` in the text, in order. */
function scan(src: string): unknown[] {
  const found: unknown[] = [];
  for (let i = src.indexOf('{'); i !== -1; i = src.indexOf('{', i + 1)) {
    const end = matchingBrace(src, i);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(src.slice(i, end + 1));
      if (isRecord(value) && value.format === 'rwtm-machine') {
        found.push(value);
        i = end; // continue after this object, so its inner braces are not scanned again
      }
    } catch {
      // not JSON; try the next brace
    }
  }
  return found;
}

/**
 * Every machine file (JSON object with `format === 'rwtm-machine'`) found anywhere in the text: several
 * Claude replies pasted together give several. The raw text is scanned first; curly quotes are normalised
 * only as a fallback, so valid files keep them verbatim.
 */
export function extractAllMachineJson(text: string): unknown[] {
  const raw = scan(text);
  return raw.length > 0 ? raw : scan(text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
}

/** First machine file found anywhere in the text, or null. */
export function extractMachineJson(text: string): unknown | null {
  return extractAllMachineJson(text)[0] ?? null;
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
    unknownField(v, ['type', 'weights', 'unit', 'addOns'], 'loading ');
    const w = v.weights;
    if (!Array.isArray(w) || w.length === 0) return fail('stack weights must be a non-empty array');
    if (w.length > MAX_STACK_WEIGHTS) return fail(`stack weights may have at most ${MAX_STACK_WEIGHTS} values`);
    if (!w.every((x) => isNum(x) && x > 0)) return fail('stack weights must be positive numbers');
    const weights = [...(w as number[])].sort((a, b) => a - b);
    if (weights.some((x, i) => i > 0 && x === weights[i - 1])) return fail('stack weights must not contain duplicates');
    if (v.unit !== undefined && v.unit !== 'kg' && v.unit !== 'level') return fail('stack unit must be "kg" or "level"');
    const out: Loading = v.unit === undefined ? { type: 'stack', weights } : { type: 'stack', weights, unit: v.unit };
    const a = v.addOns;
    if (a === undefined || a === null || (Array.isArray(a) && a.length === 0)) return out;
    if (v.unit === 'level') return fail('addOns need a stack in kg, not levels');
    if (!Array.isArray(a) || a.length > MAX_ADD_ONS) return fail(`addOns must be an array of at most ${MAX_ADD_ONS} weights`);
    if (!a.every((x) => isNum(x) && x > 0)) return fail('addOns must be positive numbers');
    const addOns = [...(a as number[])].sort((x, y) => x - y);
    if (addOns.some((x, i) => i > 0 && x === addOns[i - 1])) return fail('addOns must not contain duplicates');
    return { ...out, addOns };
  }
  if (v.type === 'plate') {
    unknownField(v, ['type', 'base', 'step'], 'loading ');
    if (!isNum(v.base) || v.base < 0) return fail('plate base must be a number of 0 or more');
    if (!isNum(v.step) || v.step < MIN_PLATE_STEP) return fail(`plate step must be at least ${MIN_PLATE_STEP}`);
    return { type: 'plate', base: v.base, step: v.step };
  }
  if (v.type === 'plates') {
    unknownField(v, ['type', 'base', 'plates', 'sides'], 'loading ');
    if (!isNum(v.base) || v.base < 0) return fail('plates base must be a number of 0 or more');
    const p = v.plates;
    if (!Array.isArray(p) || p.length === 0) return fail('plates must be a non-empty array of plate weights');
    if (p.length > MAX_PLATE_SIZES) return fail(`plates may have at most ${MAX_PLATE_SIZES} sizes`);
    if (!p.every((x) => isNum(x) && x >= MIN_PLATE_STEP)) return fail(`plate weights must be at least ${MIN_PLATE_STEP}`);
    const plates = [...(p as number[])].sort((a, b) => a - b);
    if (plates.some((x, i) => i > 0 && x === plates[i - 1])) return fail('plates must not contain duplicates');
    const sides = v.sides ?? 2;
    if (sides !== 1 && sides !== 2) return fail('plates sides must be 1 or 2');
    return { type: 'plates', base: v.base, plates, sides };
  }
  if (v.type === 'free') {
    unknownField(v, ['type', 'start', 'step', 'max', 'bigStepFrom', 'bigStep'], 'loading ');
    if (!isNum(v.start) || v.start < 0) return fail('free start must be a number of 0 or more');
    if (!isNum(v.step) || v.step < MIN_PLATE_STEP) return fail(`free step must be at least ${MIN_PLATE_STEP}`);
    if (!isNum(v.max) || !(v.max > v.start)) return fail('free max must be above start');
    const big = v.bigStepFrom !== undefined || v.bigStep !== undefined;
    if (big && (!isNum(v.bigStepFrom) || !isNum(v.bigStep) || v.bigStep < MIN_PLATE_STEP)) {
      return fail('free bigStepFrom and bigStep must be given together, bigStep at least ' + MIN_PLATE_STEP);
    }
    return big
      ? { type: 'free', start: v.start, step: v.step, max: v.max, bigStepFrom: v.bigStepFrom as number, bigStep: v.bigStep as number }
      : { type: 'free', start: v.start, step: v.step, max: v.max };
  }
  if (v.type === 'bodyweight') {
    unknownField(v, ['type', 'step', 'max'], 'loading ');
    if (!isNum(v.step) || v.step < MIN_PLATE_STEP) return fail(`bodyweight step must be at least ${MIN_PLATE_STEP}`);
    if (!isNum(v.max) || v.max <= 0) return fail('bodyweight max must be above 0');
    return { type: 'bodyweight', step: v.step, max: v.max };
  }
  return fail('loading type must be "stack", "plate", "plates", "free" or "bodyweight"');
}

/** Loading types each kind of exercise can use. */
const FITS: Record<Kind, Loading['type'][]> = {
  machine: ['stack', 'plate', 'plates'],
  free: ['free', 'plates', 'stack'],
  bodyweight: ['bodyweight'],
};

function parseMachine(
  m: unknown,
  known: Map<string, CatalogExercise>,
  declared: Map<string, CatalogExercise>,
): { machine: ParsedMachine; newExercise: CatalogExercise | null } {
  if (!isRecord(m)) return fail('must be an object');
  unknownField(m, ['exercise', 'newExercise', 'label', 'loading', 'notes', 'hidden'], '');
  if (typeof m.exercise !== 'string' || !m.exercise) return fail('exercise must be a catalogue id');
  if (m.label !== undefined && typeof m.label !== 'string') return fail('label must be a string');
  if (m.notes !== undefined && typeof m.notes !== 'string') return fail('notes must be a string');
  if (m.hidden !== undefined && typeof m.hidden !== 'boolean') return fail('hidden must be true or false');

  let newExercise: CatalogExercise | null = null;
  if (m.newExercise !== undefined && m.newExercise !== null) {
    newExercise = parseNewExercise(m.newExercise);
    if (m.exercise !== newExercise.id) return fail('exercise must equal newExercise id when newExercise is given');
    if (known.has(newExercise.id)) {
      newExercise = null; // already in the catalogue: reuse it, the existing definition wins
    } else {
      const earlier = declared.get(newExercise.id);
      if (earlier && JSON.stringify(earlier) !== JSON.stringify(newExercise)) {
        return fail(`newExercise "${newExercise.id}" is defined differently elsewhere in the file`);
      }
    }
  } else if (!known.has(m.exercise) && !declared.has(m.exercise)) {
    return fail(`unknown exercise "${m.exercise}"`);
  }

  const loading = parseLoading(m.loading);
  const kind = (known.get(m.exercise) ?? declared.get(m.exercise) ?? newExercise)?.kind ?? 'machine';
  if (!FITS[kind].includes(loading.type)) {
    return fail(`loading type "${loading.type}" does not fit a ${kind === 'machine' ? 'machine' : kind} exercise`);
  }
  return {
    machine: {
      catalogId: m.exercise,
      label: (m.label as string | undefined) ?? '',
      notes: (m.notes as string | undefined) ?? '',
      loading,
      ...(m.hidden === true ? { hidden: true } : {}),
    },
    newExercise,
  };
}

const NOT_FOUND = 'No machine file found: expected JSON with "format": "rwtm-machine"';

/** Parses one machine file object. `declared` holds new exercises from earlier files of the same batch. */
function parseRoot(
  root: unknown,
  known: Map<string, CatalogExercise>,
  declared: Map<string, CatalogExercise>,
): { machines: ParsedMachine[]; declared: Map<string, CatalogExercise>; gymName: string | null } {
  if (!isRecord(root)) return fail(NOT_FOUND);
  for (const k of Object.keys(root)) {
    if (!['format', 'version', 'gym', 'machines'].includes(k)) fail(`unknown field "${k}"`);
  }
  if (root.version !== 1) fail('Unsupported file version (expected "version": 1)');
  let gymName: string | null = null;
  if (root.gym !== undefined && root.gym !== null) {
    if (!isRecord(root.gym)) fail('gym must be an object with a name');
    const g = root.gym as Rec;
    unknownField(g, ['name'], 'gym ');
    if (typeof g.name !== 'string' || !g.name.trim()) fail('gym name must be a non-empty string');
    gymName = (g.name as string).trim();
  }
  // A gym file may list no equipment (an empty gym); a machine file must list some.
  if (!Array.isArray(root.machines) || (root.machines.length === 0 && gymName === null)) {
    fail('"machines" must be a non-empty array');
  }

  const mine = new Map(declared);
  const machines: ParsedMachine[] = [];
  const list = root.machines as unknown[];
  for (let i = 0; i < list.length; i++) {
    try {
      const { machine, newExercise } = parseMachine(list[i], known, mine);
      machines.push(machine);
      if (newExercise && !mine.has(newExercise.id)) mine.set(newExercise.id, newExercise);
    } catch (e) {
      if (e instanceof Invalid) fail(`Machine ${i + 1}: ${e.message}`);
      throw e;
    }
  }
  return { machines, declared: mine, gymName };
}

export function parseMachineFile(text: string, catalog: CatalogExercise[]): ParseResult {
  try {
    const { machines, declared } = parseRoot(extractMachineJson(text), new Map(catalog.map((e) => [e.id, e])), new Map());
    return { ok: true, machines, newExercises: [...declared.values()] };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

export interface BatchSource {
  /** Shown in error messages, e.g. the file name. */
  name: string;
  text: string;
}

export interface BatchResult {
  machines: ParsedMachine[];
  newExercises: CatalogExercise[];
  /** One line per file (or machine file within a text) that could not be read; the others still import. */
  errors: string[];
  /** The gym name of the first gym file read (an exported gym), if any. */
  gymName: string | null;
}

const sameParsed = (a: ParsedMachine, b: ParsedMachine) =>
  a.catalogId === b.catalogId && a.label === b.label && JSON.stringify(a.loading) === JSON.stringify(b.loading);

/**
 * Parses several files or pasted replies at once. Each source may hold several machine files; each machine file
 * is all-or-nothing, and a bad one is reported in `errors` without blocking the rest. Machines listed twice
 * (the same photo sent twice) are kept once.
 */
export function parseMachineBatch(sources: BatchSource[], catalog: CatalogExercise[]): BatchResult {
  const known = new Map(catalog.map((e) => [e.id, e]));
  let declared = new Map<string, CatalogExercise>();
  let gymName: string | null = null;
  const machines: ParsedMachine[] = [];
  const errors: string[] = [];
  for (const src of sources) {
    const roots = extractAllMachineJson(src.text);
    if (roots.length === 0) {
      errors.push(sources.length > 1 ? `${src.name}: ${NOT_FOUND}` : NOT_FOUND);
      continue;
    }
    roots.forEach((root, j) => {
      try {
        const parsed = parseRoot(root, known, declared);
        declared = parsed.declared;
        gymName ??= parsed.gymName;
        for (const m of parsed.machines) if (!machines.some((x) => sameParsed(x, m))) machines.push(m);
      } catch (e) {
        if (!(e instanceof Invalid)) throw e;
        const where = [sources.length > 1 ? src.name : '', roots.length > 1 ? `file ${j + 1}` : ''].filter(Boolean);
        errors.push(where.length ? `${where.join(', ')}: ${e.message}` : e.message);
      }
    });
  }
  return { machines, newExercises: [...declared.values()], errors, gymName };
}
