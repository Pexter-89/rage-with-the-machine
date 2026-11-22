import { useEffect, useState } from 'react';
import { addCustomEntries, getCatalog } from '../../db/catalogRepo.js';
import { db } from '../../db/db.js';
import { deleteGymExercise, saveGymExercise } from '../../db/gymRepo.js';
import { recomputePlateHistory } from '../../db/sessionRepo.js';
import { CATEGORIES, DEFAULT_PLATES } from '../../domain/catalog.js';
import { parseWeightInput } from '../../domain/loading.js';
import { oneLine } from '../lib/errors.js';
import { formatWeight } from '../../domain/metrics.js';
import TopBar from '../components/TopBar.js';
import { navigate } from '../router.js';
import { askConfirm } from '../lib/confirm.js';
import { Fragment, html } from '../../lib/html.js';

/**
 * @typedef {object} Props
 * @property {string} gymId
 * @property {string | 'new'} geId
 * @property {string} [catalogId]
 */

const NEW = '__new__';
const MIN_STEP = 0.25;

/** @typedef {Loading['type']} LoadingType */

/**
 * @typedef {object} Form
 * @property {string} catalogId
 * @property {string} newName
 * @property {Category} newCategory
 * @property {string} label
 * @property {string} notes
 * @property {LoadingType} loadingType
 * @property {string} weights
 * @property {'kg' | 'level'} unit
 * @property {string} base
 * @property {string} step
 * @property {string} start
 * @property {string} max
 * @property {string} plates
 * @property {1 | 2} sides
 * @property {string} addOns
 */

/** @param {string} name */
const slug = (name) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** @param {string} s */
const num = (s) => parseWeightInput(s);

/**
 * @param {CatalogExercise['kind'] | undefined} kind
 * @returns {LoadingType}
 */
function loadingTypeFor(kind) {
  return kind === 'free' ? 'free' : kind === 'bodyweight' ? 'bodyweight' : 'stack';
}

/** Loading types each kind of exercise can use, in menu order. */
const TYPES = {
  machine: ['stack', 'plate', 'plates'],
  free: ['free', 'plates', 'stack'],
  bodyweight: ['bodyweight'],
};

/**
 * @param {CatalogExercise['kind']} kind
 * @param {LoadingType} t
 * @returns {string}
 */
function typeLabel(kind, t) {
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

/**
 * @param {CatalogExercise['kind']} kind
 * @param {LoadingType} t
 * @returns {boolean}
 */
function fits(kind, t) {
  return TYPES[kind].includes(t);
}

/** @param {number[]} ws */
const listText = (ws) =>
  [...ws]
    .sort((a, b) => a - b)
    .map(formatWeight)
    .join(' ');

/**
 * Parses a list of positive numbers separated by spaces or ";" (a "," followed by a space also separates).
 * @param {string} text
 * @param {string} what
 * @returns {number[] | string}
 */
function parseList(text, what) {
  const parts = text.split(/[\s;]+|,(?=\s|$)/).filter(Boolean);
  if (parts.length === 0) return `Enter at least one ${what}`;
  const out = [];
  for (const p of parts) {
    const n = num(p);
    if (n === null || !(n > 0)) return `${what[0].toUpperCase() + what.slice(1)}s must be positive numbers ("${p}")`;
    out.push(n);
  }
  if (new Set(out).size !== out.length) return `Duplicate ${what}s in the list`;
  return out.sort((a, b) => a - b);
}

/**
 * @param {Loading} l
 * @returns {Pick<Form, 'loadingType' | 'weights' | 'unit' | 'base' | 'step' | 'start' | 'max' | 'plates' | 'sides' | 'addOns'>}
 */
function formFromLoading(l) {
  const blank = {
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
  switch (l.type) {
    case 'stack':
      return {
        ...blank,
        loadingType: 'stack',
        weights: [...l.weights]
          .sort((a, b) => a - b)
          .map(formatWeight)
          .join(', '),
        unit: l.unit ?? 'kg',
        addOns: l.addOns ? listText(l.addOns) : '',
      };
    case 'plate':
      return { ...blank, loadingType: 'plate', base: formatWeight(l.base), step: formatWeight(l.step) };
    case 'plates':
      return {
        ...blank,
        loadingType: 'plates',
        base: formatWeight(l.base),
        plates: listText(l.plates),
        sides: l.sides,
      };
    case 'free':
      return {
        ...blank,
        loadingType: 'free',
        start: formatWeight(l.start),
        step: formatWeight(l.step),
        max: formatWeight(l.max),
      };
    case 'bodyweight':
      return { ...blank, loadingType: 'bodyweight', step: formatWeight(l.step), max: formatWeight(l.max) };
  }
}

const EMPTY = {
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

/** @param {Props} props */
export default function ExerciseEdit({ gymId, geId, catalogId }) {
  const [catalog, setCatalog] = useState(null);
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [setCount, setSetCount] = useState(0);
  const [loadError, setLoadError] = useState(null);

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
      let next = { ...EMPTY };
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

  const route = { name: 'exercise', gymId, geId, ...(catalogId ? { catalogId } : {}) };
  if (!catalog || !form)
    return html`
      <main className="screen">
        <${TopBar} route=${route} />
        ${
          loadError &&
          html`
          <p className="error" role="alert">
            ${loadError}
          </p>
        `
        }
      </main>
    `;

  const set = (patch) => setForm({ ...form, ...patch });
  const entry = catalog.find((e) => e.id === form.catalogId);
  const isNew = form.catalogId === NEW;
  // The catalogue entry of an existing or free/bodyweight override is fixed; only new machines pick one.
  const locked = !!existing || (!!catalogId && !!entry && entry.kind !== 'machine');
  const kind = isNew ? 'machine' : entry?.kind;
  const lt = form.loadingType;

  function chooseCatalog(id) {
    const e = catalog.find((c) => c.id === id);
    const patch = { catalogId: id };
    if (id === NEW) patch.loadingType = fits('machine', form.loadingType) ? form.loadingType : 'stack';
    else if (e && !fits(e.kind, form.loadingType)) {
      Object.assign(
        patch,
        { loadingType: loadingTypeFor(e.kind) },
        e.defaultLoading ? formFromLoading(e.defaultLoading) : {},
      );
    }
    set(patch);
  }

  function buildLoading() {
    if (!kind) return 'Choose an exercise';
    if (!fits(kind, lt)) return 'This loading type does not fit the exercise';
    if (lt === 'stack') {
      const weights = parseList(form.weights, 'weight');
      if (typeof weights === 'string') return weights;
      if (form.unit === 'level' || !form.addOns.trim()) return { type: 'stack', weights, unit: form.unit };
      const addOns = parseList(form.addOns, 'add-on weight');
      if (typeof addOns === 'string') return addOns;
      if (addOns.length > 3) return 'At most 3 add-on weights';
      return { type: 'stack', weights, unit: form.unit, addOns };
    }
    if (lt === 'plates') {
      const base = num(form.base);
      if (base === null || base < 0) return 'Bar or sled weight must be 0 or more';
      const plates = parseList(form.plates, 'plate');
      if (typeof plates === 'string') return plates;
      if (plates[0] < MIN_STEP) return `Plates must be at least ${MIN_STEP} kg`;
      return { type: 'plates', base, plates, sides: form.sides };
    }
    if (lt === 'plate') {
      const base = num(form.base);
      const step = num(form.step);
      if (base === null || base < 0) return 'Sled weight must be 0 or more';
      if (step === null || step < MIN_STEP) return `Plate step must be at least ${MIN_STEP}`;
      return { type: 'plate', base, step };
    }
    const step = num(form.step);
    const max = num(form.max);
    if (step === null || step < MIN_STEP) return `Step must be at least ${MIN_STEP}`;
    if (max === null) return 'Enter a max weight';
    if (lt === 'bodyweight') return { type: 'bodyweight', step, max };
    const start = num(form.start);
    if (start === null) return 'Enter a start weight';
    if (!(start < max)) return 'Start must be below max';
    const prev =
      existing?.loading.type === 'free'
        ? existing.loading
        : entry?.defaultLoading?.type === 'free'
          ? entry.defaultLoading
          : null;
    const big =
      prev && prev.bigStepFrom !== undefined && prev.bigStep !== undefined
        ? { bigStepFrom: prev.bigStepFrom, bigStep: prev.bigStep }
        : {};
    return { type: 'free', start, step, max, ...big };
  }

  async function save() {
    if (busy) return;
    setError(null);
    let cid = form.catalogId;
    if (isNew) {
      const name = form.newName.trim();
      if (!name) return setError('Enter a name for the new exercise');
      cid = slug(name);
      if (!cid) return setError('Enter a name for the new exercise');
      if (catalog.some((e) => e.id === cid)) return setError('An exercise with this name already exists');
    } else if (!entry) {
      return setError('Choose an exercise');
    }
    const loading = buildLoading();
    if (typeof loading === 'string') return setError(loading);

    setBusy(true);
    try {
      if (isNew) {
        await addCustomEntries([
          { id: cid, name: form.newName.trim(), category: form.newCategory, kind: 'machine', builtIn: false },
        ]);
      }
      const old = existing?.loading;
      const plateLike = (l) => l?.type === 'plate' || l?.type === 'plates';
      if (existing && plateLike(old) && plateLike(loading) && old.base !== loading.base) {
        const n = (await db.sets.where('gymExerciseId').equals(existing.id).toArray()).filter(
          (s) => s.baseWeight === old.base,
        ).length;
        if (n > 0 && (await askConfirm(`Recompute ${n} past sets for the new sled weight?`, 'Recompute'))) {
          await recomputePlateHistory(existing.id, old.base, loading.base);
        }
      }
      await saveGymExercise({
        id: existing?.id,
        gymId,
        catalogId: cid,
        label: form.label.trim(),
        notes: form.notes.trim(),
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
  const field = (label, key, props = {}) =>
    html`
    <label className="field">
      <span>${label}</span>
      <input value=${form[key]} onChange=${(e) => set({ [key]: e.target.value })} inputMode=${props.inputMode} />
    </label>
  `;

  return html`
    <main className="screen">
      <${TopBar} route=${route} title=${existing ? 'Edit exercise' : 'Add exercise'} />

      <form
        className="form"
        onSubmit=${(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Exercise</span>
          <select value=${form.catalogId} disabled=${locked} onChange=${(e) => chooseCatalog(e.target.value)}>
            ${!form.catalogId && html`<option value="">Choose…</option>`}
            ${locked && entry && html`<option value=${entry.id}>${entry.name}</option>`}
            ${
              !locked &&
              html`
              <${Fragment}>
                ${CATEGORIES.map((c) => {
                  const inCat = machines.filter((e) => e.category === c.id);
                  return inCat.length === 0
                    ? null
                    : html`
                    <optgroup key=${c.id} label=${c.name}>
                      ${inCat.map(
                        (e) =>
                          html`
                        <option key=${e.id} value=${e.id}>
                          ${e.name}
                        </option>
                      `,
                      )}
                    </optgroup>
                  `;
                })}
                <option value=${NEW}>＋ New exercise</option>
              </${Fragment}>
            `
            }
          </select>
        </label>

        ${
          isNew &&
          html`
          <${Fragment}>
            ${field('New exercise name', 'newName')}
            <label className="field">
              <span>New exercise category</span>
              <select value=${form.newCategory} onChange=${(e) => set({ newCategory: e.target.value })}>
                ${CATEGORIES.map(
                  (c) =>
                    html`
                  <option key=${c.id} value=${c.id}>
                    ${c.name}
                  </option>
                `,
                )}
              </select>
            </label>
            <p className="hint">Kind: machine</p>
          </${Fragment}>
        `
        }

        ${field('Label', 'label')}

        ${
          kind &&
          TYPES[kind].length > 1 &&
          html`
          <label className="field">
            <span>Loading type</span>
            <select
              value=${lt}
              onChange=${(e) => {
                const t = e.target.value;
                // A barbell starts from the standard 20 kg bar; a sled has no sensible default.
                set({ loadingType: t, ...(t === 'plates' && !form.base && kind === 'free' ? { base: '20' } : {}) });
              }}
            >
              ${TYPES[kind].map(
                (t) =>
                  html`
                <option key=${t} value=${t}>
                  ${typeLabel(kind, t)}
                </option>
              `,
              )}
            </select>
          </label>
        `
        }

        ${
          lt === 'stack' &&
          html`
          <${Fragment}>
            ${field('Stack weights', 'weights')}
            <p className="hint">Separate with spaces; use , or . for decimals</p>
            <div className="inline-form" role="group" aria-label="Unit">
              ${['kg', 'level'].map(
                (u) =>
                  html`
                <button
                  key=${u}
                  type="button"
                  className=${'btn btn-small ' + (form.unit === u ? 'btn-primary' : 'btn-ghost')}
                  aria-pressed=${form.unit === u}
                  onClick=${() => set({ unit: u })}
                >
                  ${u === 'kg' ? 'kg' : 'Level'}
                </button>
              `,
              )}
            </div>
                      ${
                        form.unit === 'kg' &&
                        html`
              <${Fragment}>
                ${field('Add-on weights (kg, optional)', 'addOns', { inputMode: 'decimal' })}
                <p className="hint">A small weight a switch or lever adds on top of the stack, e.g. 2.5. Leave empty if none.</p>
              </${Fragment}>
            `
                      }
          </${Fragment}>
        `
        }
        ${
          lt === 'plate' &&
          html`
          <${Fragment}>
            ${field('Sled weight (kg)', 'base', { inputMode: 'decimal' })}
            ${field('Plate step (kg)', 'step', { inputMode: 'decimal' })}
          </${Fragment}>
        `
        }
        ${
          lt === 'plates' &&
          html`
          <${Fragment}>
            ${field(kind === 'machine' ? 'Sled weight (kg)' : 'Bar weight (kg)', 'base', { inputMode: 'decimal' })}
            ${field('Plates (kg)', 'plates')}
            <p className="hint">The plate sizes you can load, separated with spaces</p>
            <div className="inline-form" role="group" aria-label="Plates go on">
              ${[2, 1].map(
                (n) =>
                  html`
                <button
                  key=${n}
                  type="button"
                  className=${'btn btn-small ' + (form.sides === n ? 'btn-primary' : 'btn-ghost')}
                  aria-pressed=${form.sides === n}
                  onClick=${() => set({ sides: n })}
                >
                  ${n === 2 ? 'Pairs, both sides' : 'One side'}
                </button>
              `,
              )}
            </div>
          </${Fragment}>
        `
        }
        ${
          lt === 'free' &&
          html`
          <${Fragment}>
            ${field('Start (kg)', 'start', { inputMode: 'decimal' })}
            ${field('Step (kg)', 'step', { inputMode: 'decimal' })}
            ${field('Max (kg)', 'max', { inputMode: 'decimal' })}
          </${Fragment}>
        `
        }
        ${
          lt === 'bodyweight' &&
          html`
          <${Fragment}>
            ${field('Step (kg)', 'step', { inputMode: 'decimal' })}
            ${field('Max (kg)', 'max', { inputMode: 'decimal' })}
          </${Fragment}>
        `
        }

        <label className="field">
          <span>Notes</span>
          <textarea rows=${3} value=${form.notes} onChange=${(e) => set({ notes: e.target.value })} />
        </label>

        ${
          error &&
          html`
          <p className="error" role="alert">
            ${error}
          </p>
        `
        }
        <div className="nav-row">
          <button type="submit" className="btn btn-primary" disabled=${busy}>
            Save
          </button>
          ${
            existing &&
            setCount === 0 &&
            html`
            <button type="button" className="btn btn-ghost" onClick=${() => void remove()}>
              Delete
            </button>
          `
          }
          ${
            existing &&
            setCount > 0 &&
            html`
            <button type="button" className="btn btn-ghost" onClick=${() => void toggleHidden()}>
              ${existing.hidden ? 'Show' : 'Hide'}
            </button>
          `
          }
        </div>
      </form>
    </main>
  `;
}
