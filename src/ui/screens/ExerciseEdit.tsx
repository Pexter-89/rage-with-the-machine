import { useEffect, useState } from 'react';
import { addCustomEntries, getCatalog } from '../../db/catalogRepo';
import { db } from '../../db/db';
import { deleteGymExercise, saveGymExercise } from '../../db/gymRepo';
import { recomputePlateHistory } from '../../db/sessionRepo';
import { CATEGORIES } from '../../domain/catalog';
import { parseWeightInput } from '../../domain/loading';
import { formatWeight } from '../../domain/metrics';
import type { CatalogExercise, Category, GymExercise, Loading } from '../../domain/types';
import { navigate } from '../router';

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

function fits(kind: CatalogExercise['kind'], t: LoadingType): boolean {
  return kind === 'machine' ? t === 'stack' || t === 'plate' : kind === t;
}

function formFromLoading(l: Loading): Pick<Form, 'loadingType' | 'weights' | 'unit' | 'base' | 'step' | 'start' | 'max'> {
  const blank = { weights: '', unit: 'kg' as const, base: '', step: '', start: '', max: '' };
  switch (l.type) {
    case 'stack':
      return { ...blank, loadingType: 'stack', weights: [...l.weights].sort((a, b) => a - b).map(formatWeight).join(', '), unit: l.unit ?? 'kg' };
    case 'plate':
      return { ...blank, loadingType: 'plate', base: formatWeight(l.base), step: formatWeight(l.step) };
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
};

export default function ExerciseEdit({ gymId, geId, catalogId }: Props) {
  const [catalog, setCatalog] = useState<CatalogExercise[] | null>(null);
  const [existing, setExisting] = useState<GymExercise | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setCount, setSetCount] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
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
    })();
    return () => {
      live = false;
    };
  }, [gymId, geId, catalogId]);

  if (!catalog || !form) return <main className="screen" />;

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
      const parts = form!.weights.split(/[\s;]+|,(?=\s|$)/).filter(Boolean);
      if (parts.length === 0) return 'Enter at least one weight';
      const weights: number[] = [];
      for (const p of parts) {
        const n = num(p);
        if (n === null || !(n > 0)) return `Weights must be positive numbers ("${p}")`;
        weights.push(n);
      }
      if (new Set(weights).size !== weights.length) return 'Duplicate weights in the list';
      weights.sort((a, b) => a - b);
      return { type: 'stack', weights, unit: form!.unit };
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
      if (existing && old?.type === 'plate' && loading.type === 'plate' && old.base !== loading.base) {
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
      <header className="bar">
        <button className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'gym', gymId })}>
          ‹ Back
        </button>
        <h1 className="title">{existing ? 'Edit exercise' : 'Add exercise'}</h1>
      </header>

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

        {kind === 'machine' && (
          <label className="field">
            <span>Loading type</span>
            <select value={lt} onChange={(e) => set({ loadingType: e.target.value as LoadingType })}>
              <option value="stack">Stack (selectorised)</option>
              <option value="plate">Plate-loaded</option>
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
          </>
        )}
        {lt === 'plate' && (
          <>
            {field('Sled weight (kg)', 'base', { inputMode: 'decimal' })}
            {field('Plate step (kg)', 'step', { inputMode: 'decimal' })}
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
