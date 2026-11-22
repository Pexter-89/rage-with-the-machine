import { useEffect, useState } from 'react';
import { getCatalog } from '../../db/catalogRepo.js';
import { db } from '../../db/db.js';
import { addProgram, deleteProgram, getProgram, updateProgram } from '../../db/programRepo.js';
import { availabilityAt, MAX_REPS, MAX_SETS, MIN_REPS, MIN_SETS } from '../../domain/programs.js';
import ConfirmSheet from '../components/ConfirmSheet.js';
import ExercisePickerSheet from '../components/ExercisePickerSheet.js';
import Stepper from '../components/Stepper.js';
import TopBar from '../components/TopBar.js';
import { oneLine } from '../lib/errors.js';
import { navigate } from '../router.js';
import { html } from '../../lib/html.js';

/** Target for an exercise added to a program; the steppers change it. */
const NEW_ITEM = { sets: 3, reps: 10 };

/**
 * Program editor: name and an ordered list of exercises with sets × reps. Opened from a gym's program list,
 * so it also says which exercises that gym lacks; the program itself is the same at every gym.
 * @param {{ gymId: string, programId: string }} props
 */
export default function ProgramEdit({ gymId, programId }) {
  const isNew = programId === 'new';
  const [loaded, setLoaded] = useState(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState([]);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [catalog, mine, program] = await Promise.all([
        getCatalog(),
        db.gymExercises.where('gymId').equals(gymId).toArray(),
        isNew ? Promise.resolve(undefined) : getProgram(programId),
      ]);
      if (!live) return;
      if (!isNew && !program) {
        navigate({ name: 'programs', gymId });
        return;
      }
      setName(program?.name ?? '');
      // Each row gets a local key, so moving rows keeps React's state with the right row.
      setItems((program?.items ?? []).map((i) => ({ ...i, k: crypto.randomUUID() })));
      setLoaded({ catalog, mine, byId: new Map(catalog.map((e) => [e.id, e])) });
    })();
    return () => {
      live = false;
    };
  }, [gymId, programId, isNew]);

  const route = { name: 'program', gymId, programId };
  const title = isNew ? 'New program' : 'Edit program';
  if (!loaded)
    return html`
      <main className="screen">
        <${TopBar} route=${route} title=${title} />
      </main>
    `;
  const { catalog, mine, byId } = loaded;

  const patch = (k, change) => setItems((list) => list.map((i) => (i.k === k ? { ...i, ...change } : i)));
  const move = (index, delta) =>
    setItems((list) => {
      const j = index + delta;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  async function save() {
    if (!name.trim()) return setError('Give the program a name');
    if (items.length === 0) return setError('Add at least one exercise');
    const fields = { name, items: items.map(({ catalogId, sets, reps }) => ({ catalogId, sets, reps })) };
    try {
      if (isNew) await addProgram(fields, Date.now());
      else await updateProgram(programId, fields, Date.now());
      navigate({ name: 'programs', gymId });
    } catch (e) {
      setError(oneLine(e));
    }
  }

  return html`
    <main className="screen">
      <${TopBar} route=${route} title=${title} />
      <label className="field">
        Name
        <input
          aria-label="Program name"
          placeholder="e.g. Upper body"
          value=${name}
          onChange=${(e) => setName(e.target.value)}
        />
      </label>

      <h2 className="section-title">Exercises</h2>
      ${items.length === 0 && html`<p className="hint">No exercises yet.</p>`}
      <ol className="list program-items">
        ${items.map((it, i) => {
          const entry = byId.get(it.catalogId);
          const exName = entry?.name ?? it.catalogId;
          const here = availabilityAt(entry, mine).status !== 'missing';
          return html`
            <li key=${it.k} className="row program-item" aria-label=${exName}>
              <div className="program-item-head">
                <span className="card-name">${exName}</span>
                ${!here && html`<span className="tag">Not at this gym</span>`}
              </div>
              <div className="program-item-target">
                <${Stepper}
                  value=${it.sets}
                  min=${MIN_SETS}
                  max=${MAX_SETS}
                  unit="sets"
                  name=${exName}
                  onChange=${(sets) => patch(it.k, { sets })}
                />
                <span className="times" aria-hidden="true">×</span>
                <${Stepper}
                  value=${it.reps}
                  min=${MIN_REPS}
                  max=${MAX_REPS}
                  unit="reps"
                  name=${exName}
                  onChange=${(reps) => patch(it.k, { reps })}
                />
              </div>
              <div className="actions">
                <button
                  className="btn btn-ghost btn-icon"
                  aria-label=${`Move ${exName} up`}
                  disabled=${i === 0}
                  onClick=${() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  aria-label=${`Move ${exName} down`}
                  disabled=${i === items.length - 1}
                  onClick=${() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="btn btn-ghost btn-small"
                  aria-label=${`Remove ${exName}`}
                  onClick=${() => setItems((list) => list.filter((x) => x.k !== it.k))}
                >
                  Remove
                </button>
              </div>
            </li>
          `;
        })}
      </ol>
      <button className="btn btn-ghost" onClick=${() => setPicking(true)}>＋ Add exercise</button>

      ${
        error &&
        html`
        <p className="error" role="alert">
          ${error}
        </p>
      `
      }
      <div className="spacer" />
      <div className="bottom-actions">
        <button className="btn btn-primary" onClick=${() => void save()}>Save program</button>
        ${
          !isNew &&
          html`
          <button className="btn btn-ghost btn-danger-text" onClick=${() => setConfirmDelete(true)}>
            Delete program
          </button>
        `
        }
      </div>

      <${ExercisePickerSheet}
        open=${picking}
        catalog=${catalog}
        onPick=${(catalogId) => {
          setItems((list) => [...list, { catalogId, ...NEW_ITEM, k: crypto.randomUUID() }]);
          setError(null);
        }}
        onClose=${() => setPicking(false)}
      />
      <${ConfirmSheet}
        title="Delete program?"
        message=${confirmDelete ? `${name.trim() || 'This program'} will be deleted. Sessions done with it are kept.` : null}
        onConfirm=${async () => {
          await deleteProgram(programId);
          navigate({ name: 'programs', gymId });
        }}
        onClose=${() => setConfirmDelete(false)}
      />
    </main>
  `;
}
