import { useEffect, useState } from 'react';
import { addCustomEntries, getCatalog } from '../../db/catalogRepo';
import { db } from '../../db/db';
import { deleteGymExercise, saveGymExercise } from '../../db/gymRepo';
import { recomputePlateHistory } from '../../db/sessionRepo';
import { CATEGORIES, DEFAULT_PLATES } from '../../domain/catalog';
import { parseWeightInput } from '../../domain/loading';
import { oneLine } from '../lib/errors';
import { formatWeight } from '../../domain/metrics';
import type { CatalogExercise, Category, GymExercise, Loading } from '../../domain/types';
import TopBar from '../components/TopBar';
import { navigate, type Route } from '../router';

interface Props {
  gymId: string;
  geId: string | 'new';
  catalogId?: string;
}

const NEW = '__new__';
const MIN_STEP = 0.25;

type LoadingType = Loading['type'];

interface Form {
  catalogId: string; // catalogue id or NEW
  newName: string;
  newCategory: Category;
  label: string;
  notes: string;
  loadingType: LoadingType;
  weights: string;
  unit: 'kg' | 'level';
  base: string;
  step: string;
  start: string;
  max: string;
  plates: string;
  sides: 1 | 2;
  addOns: string;
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const num = (s: string) => parseWeightInput(s);

function loadingTypeFor(kind: CatalogExercise['kind'] | undefined): LoadingType {
  return kind === 'free' ? 'free' : kind === 'bodyweight' ? 'bodyweight' : 'stack';
}

/** Loading types each kind of exercise can use, in menu order. */
const TYPES: Record<CatalogExercise['kind'], LoadingType[]> = {
  machine: ['stack', 'plate', 'plates'],
  free: ['free', 'plates', 'stack'],
  bodyweight: ['bodyweight'],
};

function typeLabel(kind: CatalogExercise['kind'], t: LoadingType): string {
  switch (t) {
    case 'stack':
      return kind === 'machine' ? 'Stack (selectorised)' : 'List of weights or levels';
    case 'plate':
      return 'Plate-loaded, fixed steps';
    case 'plates':
      return 'Plates, one by one';
    case 'free':
      return 'Preset intervals';
    case 'bodyweight':
      return 'Bodyweight + added weight';
  }
}

function fits(kind: CatalogExercise['kind'], t: LoadingType): boolean {
  return TYPES[kind].includes(t);
}

const listText = (ws: number[]) => [...ws].sort((a, b) => a - b).map(formatWeight).join(' ');

/** Parses a list of positive numbers separated by spaces or ";" (a "," followed by a space also separates). */
function parseList(text: string, what: string): number[] | string {
  const parts = text.split(/[\s;]+|,(?=\s|$)/).filter(Boolean);
  if (parts.length === 0) return `Enter at least one ${what}`;
  const out: number[] = [];
  for (const p of parts) {
    const n = num(p);
    if (n === null || !(n > 0)) return `${what[0].toUpperCase() + what.slice(1)}s must be positive numbers ("${p}")`;
    out.push(n);
  }
  if (new Set(out).size !== out.length) return `Duplicate ${what}s in the list`;
  return out.sort((a, b) => a - b);
}

function formFromLoading(
  l: Loading,
): Pick<Form, 'loadingType' | 'weights' | 'unit' | 'base' | 'step' | 'start' | 'max' | 'plates' | 'sides' | 'addOns'> {
  const blank = { weights: '', unit: 'kg' as const, base: '', step: '', start: '', max: '', plates: listText(DEFAULT_PLATES), sides: 2 as const, addOns: '' };
  switch (l.type) {
    case 'stack':
      return {
        ...blank,
        loadingType: 'stack',
        weights: [...l.weights].sort((a, b) => a - b).map(formatWeight).join(', '),
        unit: l.unit ?? 'kg',
        addOns: l.addOns ? listText(l.addOns) : '',
      };
    case 'plate':
      return { ...blank, loadingType: 'plate', base: formatWeight(l.base), step: formatWeight(l.step) };
    case 'plates':
      return { ...blank, loadingType: 'plates', base: formatWeight(l.base), plates: listText(l.plates), sides: l.sides };
    case 'free':
      return { ...blank, loadingType: 'free', start: formatWeight(l.start), step: formatWeight(l.step), max: formatWeight(l.max) };
    case 'bodyweight':
      return { ...blank, loadingType: 'bodyweight', step: formatWeight(l.step), max: formatWeight(l.max) };
  }
}

const EMPTY: Form = {
  catalogId: '',
  newName: '',
  newCategory: 'legs',
  label: '',
  notes: '',
  loadingType: 'stack',
  weights: '',
  unit: 'kg',
  base: '',
  step: '',
  start: '',
  max: '',
  plates: listText(DEFAULT_PLATES),
  sides: 2,
  addOns: '',
};

export default function ExerciseEdit({ gymId, geId, catalogId }: Props) {
  const [catalog, setCatalog] = useState<CatalogExercise[] | null>(null);
  const [existing, setExisting] = useState<GymExercise | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setCount, setSetCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (live) setLoadError(oneLine(e));
      }
    })();
    async function load() {
      const [cat, ge] = await Promise.all([getCatalog(), geId === 'new' ? null : db.gymExercises.get(geId)]);
      if (!live) return;
      if (geId !== 'new' && (!ge || ge.gymId !== gymId)) {
        navigate({ name: 'gym', gymId });
        return;
      }
      const entry = cat.find((e) => e.id === (ge?.catalogId ?? catalogId));
      let next: Form = { ...EMPTY };
      if (ge) {
        next = { ...next, catalogId: ge.catalogId, label: ge.label, notes: ge.notes, ...formFromLoading(ge.loading) };
      } else if (entry) {
        next = { ...next, catalogId: entry.id, loadingType: loadingTypeFor(entry.kind) };
        if (entry.defaultLoading) next = { ...next, ...formFromLoading(entry.defaultLoading) };
      }
      const count = ge ? await db.sets.where('gymExerciseId').equals(ge.id).count() : 0;
      if (!live) return;
      setSetCount(count);
      setCatalog(cat);
      setExisting(ge ?? null);
      setForm(next);
    }
    return () => {
      live = false;
    };
  }, [gymId, geId, catalogId]);

  const route: Route = { name: 'exercise', gymId, geId, ...(catalogId ? { catalogId } : {}) };
  if (!catalog || !form)
    return (
      <main className="screen">
        <TopBar route={route} />
        {loadError && (
          <p className="error" role="alert">
            {loadError}
          </p>
        )}
      </main>
    );

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const entry = catalog.find((e) => e.id === form.catalogId);
  const isNew = form.catalogId === NEW;
  // The catalogue entry of an existing or free/bodyweight override is fixed; only new machines pick one.
  const locked = !!existing || (!!catalogId && !!entry && entry.kind !== 'machine');
  const kind = isNew ? 'machine' : entry?.kind;
  const lt = form.loadingType;

  function chooseCatalog(id: string) {
    const e = catalog!.find((c) => c.id === id);
    const patch: Partial<Form> = { catalogId: id };
    if (id === NEW) patch.loadingType = fits('machine', form!.loadingType) ? form!.loadingType : 'stack';
    else if (e && !fits(e.kind, form!.loadingType)) {
      Object.assign(patch, { loadingType: loadingTypeFor(e.kind) }, e.defaultLoading ? formFromLoading(e.defaultLoading) : {});
    }
    set(patch);
  }

  function buildLoading(): Loading | string {
    if (!kind) return 'Choose an exercise';
    if (!fits(kind, lt)) return 'This loading type does not fit the exercise';
    if (lt === 'stack') {
      const weights = parseList(form!.weights, 'weight');
      if (typeof weights === 'string') return weights;
      if (form!.unit === 'level' || !form!.addOns.trim()) return { type: 'stack', weights, unit: form!.unit };
      const addOns = parseList(form!.addOns, 'add-on weight');
      if (typeof addOns === 'string') return addOns;
      if (addOns.length > 3) return 'At most 3 add-on weights';
      return { type: 'stack', weights, unit: form!.unit, addOns };
    }
    if (lt === 'plates') {
      const base = num(form!.base);
      if (base === null || base < 0) return 'Bar or sled weight must be 0 or more';
      const plates = parseList(form!.plates, 'plate');
      if (typeof plates === 'string') return plates;
      if (plates[0] < MIN_STEP) return `Plates must be at least ${MIN_STEP} kg`;
      return { type: 'plates', base, plates, sides: form!.sides };
    }
    if (lt === 'plate') {
      const base = num(form!.base);
      const step = num(form!.step);
      if (base === null || base < 0) return 'Sled weight must be 0 or more';
      if (step === null || step < MIN_STEP) return `Plate step must be at least ${MIN_STEP}`;
      return { type: 'plate', base, step };
    }
    const step = num(form!.step);
    const max = num(form!.max);
    if (step === null || step < MIN_STEP) return `Step must be at least ${MIN_STEP}`;
    if (max === null) return 'Enter a max weight';
    if (lt === 'bodyweight') return { type: 'bodyweight', step, max };
    const start = num(form!.start);
    if (start === null) return 'Enter a start weight';
    if (!(start < max)) return 'Start must be below max';
    const prev = existing?.loading.type === 'free' ? existing.loading : entry?.defaultLoading?.type === 'free' ? entry.defaultLoading : null;
    const big = prev && prev.bigStepFrom !== undefined && prev.bigStep !== undefined ? { bigStepFrom: prev.bigStepFrom, bigStep: prev.bigStep } : {};
    return { type: 'free', start, step, max, ...big };
  }

  async function save() {
    if (busy) return;
    setError(null);
    let cid = form!.catalogId;
    if (isNew) {
      const name = form!.newName.trim();
      if (!name) return setError('Enter a name for the new exercise');
      cid = slug(name);
      if (!cid) return setError('Enter a name for the new exercise');
      if (catalog!.some((e) => e.id === cid)) return setError('An exercise with this name already exists');
    } else if (!entry) {
      return setError('Choose an exercise');
    }
    const loading = buildLoading();
    if (typeof loading === 'string') return setError(loading);

    setBusy(true);
    try {
      if (isNew) {
        await addCustomEntries([{ id: cid, name: form!.newName.trim(), category: form!.newCategory, kind: 'machine', builtIn: false }]);
      }
      const old = existing?.loading;
      const plateLike = (l: Loading | undefined): l is Extract<Loading, { type: 'plate' | 'plates' }> =>
        l?.type === 'plate' || l?.type === 'plates';
      if (existing && plateLike(old) && plateLike(loading) && old.base !== loading.base) {
        const n = (await db.sets.where('gymExerciseId').equals(existing.id).toArray()).filter((s) => s.baseWeight === old.base).length;
        if (n > 0 && window.confirm(`Recompute ${n} past sets for the new sled weight?`)) {
          await recomputePlateHistory(existing.id, old.base, loading.base);
        }
      }
      await saveGymExercise({
        id: existing?.id,
        gymId,
        catalogId: cid,
        label: form!.label.trim(),
        notes: form!.notes.trim(),
        loading,
        hidden: existing?.hidden ?? false,
      });
      navigate({ name: 'gym', gymId });
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'Could not save');
      setBusy(false);
    }
  }

  async function toggleHidden() {
    if (!existing) return;
    await db.gymExercises.update(existing.id, { hidden: !existing.hidden });
    navigate({ name: 'gym', gymId });
  }

  async function remove() {
    if (!existing) return;
    await deleteGymExercise(existing.id);
    navigate({ name: 'gym', gymId });
  }

  const machines = catalog.filter((e) => e.kind === 'machine');
  const field = (label: string, key: keyof Form, props: { inputMode?: 'decimal' } = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<Form>)} inputMode={props.inputMode} />
    </label>
  );

  return (
    <main className="screen">
      <TopBar route={route} title={existing ? 'Edit exercise' : 'Add exercise'} />

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Exercise</span>
          <select value={form.catalogId} disabled={locked} onChange={(e) => chooseCatalog(e.target.value)}>
            {!form.catalogId && <option value="">Choose…</option>}
            {locked && entry && <option value={entry.id}>{entry.name}</option>}
            {!locked && (
              <>
                {CATEGORIES.map((c) => {
                  const inCat = machines.filter((e) => e.category === c.id);
                  return inCat.length === 0 ? null : (
                    <optgroup key={c.id} label={c.name}>
                      {inCat.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
                <option value={NEW}>＋ New exercise</option>
              </>
            )}
          </select>
        </label>

        {isNew && (
          <>
            {field('New exercise name', 'newName')}
            <label className="field">
              <span>New exercise category</span>
              <select value={form.newCategory} onChange={(e) => set({ newCategory: e.target.value as Category })}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">Kind: machine</p>
          </>
        )}

        {field('Label', 'label')}

        {kind && TYPES[kind].length > 1 && (
          <label className="field">
            <span>Loading type</span>
            <select
              value={lt}
              onChange={(e) => {
                const t = e.target.value as LoadingType;
                // A barbell starts from the standard 20 kg bar; a sled has no sensible default.
                set({ loadingType: t, ...(t === 'plates' && !form.base && kind === 'free' ? { base: '20' } : {}) });
              }}
            >
              {TYPES[kind].map((t) => (
                <option key={t} value={t}>
                  {typeLabel(kind, t)}
                </option>
              ))}
            </select>
          </label>
        )}

        {lt === 'stack' && (
          <>
            {field('Stack weights', 'weights')}
            <p className="hint">Separate with spaces; use , or . for decimals</p>
            <div className="inline-form" role="group" aria-label="Unit">
              {(['kg', 'level'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={'btn btn-small ' + (form.unit === u ? 'btn-primary' : 'btn-ghost')}
                  aria-pressed={form.unit === u}
                  onClick={() => set({ unit: u })}
                >
                  {u === 'kg' ? 'kg' : 'Level'}
                </button>
              ))}
            </div>
                      {form.unit === 'kg' && (
              <>
                {field('Add-on weights (kg, optional)', 'addOns', { inputMode: 'decimal' })}
                <p className="hint">A small weight a switch or lever adds on top of the stack, e.g. 2.5. Leave empty if none.</p>
              </>
            )}
          </>
        )}
        {lt === 'plate' && (
          <>
            {field('Sled weight (kg)', 'base', { inputMode: 'decimal' })}
            {field('Plate step (kg)', 'step', { inputMode: 'decimal' })}
          </>
        )}
        {lt === 'plates' && (
          <>
            {field(kind === 'machine' ? 'Sled weight (kg)' : 'Bar weight (kg)', 'base', { inputMode: 'decimal' })}
            {field('Plates (kg)', 'plates')}
            <p className="hint">The plate sizes you can load, separated with spaces</p>
            <div className="inline-form" role="group" aria-label="Plates go on">
              {([2, 1] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={'btn btn-small ' + (form.sides === n ? 'btn-primary' : 'btn-ghost')}
                  aria-pressed={form.sides === n}
                  onClick={() => set({ sides: n })}
                >
                  {n === 2 ? 'Pairs, both sides' : 'One side'}
                </button>
              ))}
            </div>
          </>
        )}
        {lt === 'free' && (
          <>
            {field('Start (kg)', 'start', { inputMode: 'decimal' })}
            {field('Step (kg)', 'step', { inputMode: 'decimal' })}
            {field('Max (kg)', 'max', { inputMode: 'decimal' })}
          </>
        )}
        {lt === 'bodyweight' && (
          <>
            {field('Step (kg)', 'step', { inputMode: 'decimal' })}
            {field('Max (kg)', 'max', { inputMode: 'decimal' })}
          </>
        )}

        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="nav-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save
          </button>
          {existing && setCount === 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => void remove()}>
              Delete
            </button>
          )}
          {existing && setCount > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => void toggleHidden()}>
              {existing.hidden ? 'Show' : 'Hide'}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
