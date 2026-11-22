import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLiveQuery } from '../../lib/useLiveQuery.js';
import { db } from '../../db/db.js';
import { getCatalog } from '../../db/catalogRepo.js';
import { resolveItem, setGymExerciseNotes } from '../../db/gymRepo.js';
import {
  SessionEndedError,
  addSet,
  deleteSet,
  getLastTime,
  prefill,
  recordHistory,
  setsForItem,
  updateSet,
} from '../../db/sessionRepo.js';
import { formatDate } from '../../domain/dates.js';
import { parseRepsInput, parseWeightInput, reachableValues, snapToWheel, wheelValues } from '../../domain/loading.js';
import { formatSetList, formatWeight, recordSetIds } from '../../domain/metrics.js';
import ConfirmSheet from '../components/ConfirmSheet.js';
import AddOnStack from '../components/AddOnStack.js';
import PlatePicker from '../components/PlatePicker.js';
import RestTimer from '../components/RestTimer.js';
import Sheet from '../components/Sheet.js';
import TopBar from '../components/TopBar.js';
import Wheel from '../components/Wheel.js';
import { oneLine } from '../lib/errors.js';
import { navigate } from '../router.js';
import { Fragment, html } from '../../lib/html.js';

const REPS = Array.from({ length: 50 }, (_, i) => i + 1);

/**
 * @typedef {{ status: 'home' } | { status: 'session' } | { status: 'ready', item: PickerItem, sets: SetEntry[], last: LastTime | null, lastGymName: string, history: SetEntry[] }} Loaded
 */

/**
 * @typedef {object} Row
 * @property {number} weight
 * @property {number} reps
 */

/**
 * @param {PickerItem} item
 * @returns {string}
 */
function weightLabel(item) {
  if (item.assisted) return 'ASSIST KG';
  if (item.loading.type === 'stack' && item.loading.unit === 'level') return 'LEVEL';
  if (item.loading.type === 'bodyweight') return '+KG';
  return 'KG';
}

/** @param {PickerItem} item */
const isLevel = (item) => item.loading.type === 'stack' && item.loading.unit === 'level';

/**
 * @typedef {object} PairProps
 * @property {PickerItem} item
 * @property {Row} row
 * @property {(update: (r: Row) => Row) => void} onChange
 */

/**
 * @typedef {object} PairHandle
 * @property {() => Row} flush
 */

const WheelPair = forwardRef(function WheelPair({ item, row, onChange }, ref) {
  const w = useRef(null);
  const r = useRef(null);
  useImperativeHandle(ref, () => ({
    flush: () => ({ weight: w.current?.flush() ?? row.weight, reps: r.current?.flush() ?? row.reps }),
  }));
  const setWeight = (weight) => onChange((r) => ({ ...r, weight }));
  return html`
    <${Fragment}>
      ${
        item.loading.type === 'plates' && !item.assisted
          ? html`<${PlatePicker} ref=${w} loading=${item.loading} value=${row.weight} onChange=${setWeight} />`
          : item.loading.type === 'stack' && item.loading.unit !== 'level' && item.loading.addOns?.length
            ? html`
        <${AddOnStack}
          ref=${w}
          label=${item.assisted ? 'STACK ASSIST KG' : 'STACK KG'}
          weights=${wheelValues(item.loading)}
          addOns=${item.loading.addOns}
          value=${row.weight}
          onChange=${setWeight}
        />
      `
            : html`
        <${Wheel}
          ref=${w}
          label=${weightLabel(item)}
          values=${wheelValues(item.loading)}
          value=${row.weight}
          onChange=${setWeight}
          parse=${parseWeightInput}
          suffix=${isLevel(item) ? 'L' : undefined}
        />
      `
      }
      <${Wheel}
        ref=${r}
        label=${item.unilateral ? 'REPS / SIDE' : 'REPS'}
        values=${REPS}
        value=${row.reps}
        onChange=${(reps) => onChange((r) => ({ ...r, reps }))}
        parse=${parseRepsInput}
      />
    </${Fragment}>
  `;
});

/**
 * The next row's values; a stack snaps values taken from last time onto what this machine can make.
 * @param {PickerItem} item
 * @param {SetEntry[]} sets
 * @param {LastTime | null} last
 * @returns {(Row & { fromLast: boolean }) | null}
 */
function nextRow(item, sets, last) {
  const p = prefill(sets, last);
  if (!p) return null;
  const snap = p.snap && item.loading.type === 'stack';
  return { ...p, weight: snap ? snapToWheel(reachableValues(item.loading), p.weight) : p.weight };
}

/** @param {{ id: string, notes: string, onClose(): void }} props */
function NoteSheet({ id, notes, onClose }) {
  const [text, setText] = useState(notes);
  const [error, setError] = useState(null);
  async function save() {
    try {
      await setGymExerciseNotes(id, text);
      onClose();
    } catch (e) {
      setError(oneLine(e));
    }
  }
  return html`
    <${Fragment}>
      <textarea
        rows=${4}
        aria-label="Machine note"
        placeholder="Seat height, pin positions…"
        value=${text}
        onChange=${(e) => setText(e.target.value)}
      />
      ${
        error &&
        html`
        <p className="error" role="alert">
          ${error}
        </p>
      `
      }
      <button className="btn btn-primary" onClick=${() => void save()}>
        Save
      </button>
    </${Fragment}>
  `;
}

/**
 * A failed write shows one line inline; a write into a session that has ended goes home.
 * @param {unknown} e
 * @param {(text: string) => void} show
 */
function writeFailed(e, show) {
  if (e instanceof SessionEndedError) navigate({ name: 'home' });
  else show(oneLine(e));
}

/** @param {{ item: PickerItem, set: SetEntry, onClose(): void }} props */
function EditSheet({ item, set, onClose }) {
  const [row, setRow] = useState({ weight: set.weight, reps: set.reps });
  const [error, setError] = useState(null);
  const pair = useRef(null);

  async function run(write) {
    try {
      await write();
      onClose();
    } catch (e) {
      writeFailed(e, setError);
    }
  }

  return html`
    <${Fragment}>
      <div className="input-row">
        <${WheelPair} ref=${pair} item=${item} row=${row} onChange=${setRow} />
      </div>
      ${
        error &&
        html`
        <p className="error" role="alert">
          ${error}
        </p>
      `
      }
      <div className="nav-row">
        <button
          className="btn btn-primary"
          onClick=${() => void run(() => updateSet(set.id, pair.current?.flush() ?? row, Date.now()))}
        >
          Save
        </button>
        <button className="btn" onClick=${() => void run(() => deleteSet(set.id, Date.now()))}>
          Delete
        </button>
      </div>
    </${Fragment}>
  `;
}

/** @param {{ sessionId: string, itemKey: string }} props */
export default function Logging({ sessionId, itemKey }) {
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return { status: 'home' };
    const catalog = await getCatalog();
    const item = await resolveItem(session.gymId, itemKey, catalog);
    if (!item) return { status: 'session' };
    const sets = await setsForItem(sessionId, item);
    const last = await getLastTime(item.catalogId, session.gymId, sessionId);
    const lastGym = last ? await db.gyms.get(last.gymId) : undefined;
    // Records are e1RM records, which mean nothing for bodyweight reps or assist weight.
    const kind = catalog.find((c) => c.id === item.catalogId)?.kind;
    const history =
      kind === 'bodyweight' || item.assisted
        ? []
        : await recordHistory(item, kind === 'machine', sessionId, session.gymId);
    return { status: 'ready', item, sets, last, lastGymName: lastGym?.name ?? '', history };
  }, [sessionId, itemKey]);

  // Computed once, when the data first loads; later live updates never overwrite the wheels.
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pair = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [editingNote, setEditingNote] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  /** When the last set was completed on this screen; leaving the screen drops the timer. */
  const [restSince, setRestSince] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (data?.status === 'home') navigate({ name: 'home' });
    else if (data?.status === 'session') navigate({ name: 'session', sessionId });
  }, [data, sessionId]);

  const route = { name: 'log', sessionId, key: itemKey };
  const loadingScreen = html`
    <main className="screen logging">
      <${TopBar} route=${route} />
    </main>
  `;
  if (!data || data.status !== 'ready') return loadingScreen;
  const { item, sets, last, lastGymName, history } = data;

  if (!row) {
    const p = nextRow(item, sets, last);
    setRow(p ? { weight: p.weight, reps: p.reps } : { weight: wheelValues(item.loading)[0] ?? 0, reps: 10 });
    return loadingScreen;
  }

  const records = recordSetIds(sets, history);
  const editing = sets.find((s) => s.id === editingId);
  const deleting = sets.find((s) => s.id === deletingId);

  async function complete() {
    if (inFlight.current || !row) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const v = pair.current?.flush() ?? row;
      const added = await addSet(sessionId, item, v.weight, v.reps, Date.now());
      // Following last time's sets moves the wheels on; otherwise they stay on the set just done.
      const next = nextRow(item, [...sets, added], last);
      if (next?.fromLast) setRow({ weight: next.weight, reps: next.reps });
      setRestSince(Date.now());
      setError(null);
    } catch (e) {
      writeFailed(e, setError);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const setText = (s) =>
    s.unit === 'level' ? `${formatWeight(s.weight)} L × ${s.reps}` : `${formatWeight(s.weight)} kg × ${s.reps}`;

  return html`
    <main className="screen logging">
      <${TopBar} route=${route} title=${item.name} />
      ${item.label && html`<p className="hint">${item.label}</p>`}
      ${
        item.gymExerciseId &&
        html`
        <button
          className=${item.notes ? 'btn btn-quiet machine-note' : 'btn btn-quiet btn-small machine-note'}
          aria-label=${item.notes ? `Machine note: ${item.notes}` : 'Add machine note'}
          onClick=${() => setEditingNote(true)}
        >
          ${item.notes || '＋ Note'}
        </button>
      `
      }

      ${
        last &&
        last.sets.length > 0 &&
        html`
        <div className="last-time">
          <div>${`Last time · ${formatDate(last.date)} · ${lastGymName}`}</div>
          <div className="last-sets">${formatSetList(last.sets)}</div>
        </div>
      `
      }

      <div className="spacer" />

      <ol className="list done-sets">
        ${sets.map(
          (s, i) =>
            html`
          <li key=${s.id} className="split">
            <button className="btn btn-left done-set" onClick=${() => setEditingId(s.id)}>
              ${`${i + 1}  ${setText(s)}`}
              ${
                records.has(s.id) &&
                html`
                <${Fragment}>
                  ${' '}
                  <span className="record">PR</span>
                </${Fragment}>
              `
              }
            </button>
            <button className="btn split-x" aria-label=${`Delete set ${i + 1}`} onClick=${() => setDeletingId(s.id)}>
              ✕
            </button>
          </li>
        `,
        )}
      </ol>

      <${RestTimer} since=${restSince} />

      <div className="input-row">
        <${WheelPair} ref=${pair} item=${item} row=${row} onChange=${(u) => setRow((r) => (r ? u(r) : r))} />
        <button className="btn btn-ok btn-complete" aria-label="Complete set" disabled=${busy} onClick=${complete}>
          ✓
        </button>
      </div>
      ${
        error &&
        html`
        <p className="error" role="alert">
          ${error}
        </p>
      `
      }

      <button className="btn btn-ghost" onClick=${() => navigate({ name: 'session', sessionId })}>
        ‹ Back to session
      </button>

      <${Sheet} open=${editingNote} title="Machine note" onClose=${() => setEditingNote(false)}>
        ${
          editingNote &&
          item.gymExerciseId &&
          html`<${NoteSheet} id=${item.gymExerciseId} notes=${item.notes} onClose=${() => setEditingNote(false)} />`
        }
      </${Sheet}>
      <${Sheet} open=${!!editing} title="Edit set" onClose=${() => setEditingId(null)}>
        ${editing && html`<${EditSheet} key=${editing.id} item=${item} set=${editing} onClose=${() => setEditingId(null)} />`}
      </${Sheet}>
      <${ConfirmSheet}
        title="Delete set?"
        message=${deleting ? `Set ${sets.indexOf(deleting) + 1}: ${setText(deleting)}` : null}
        onConfirm=${async () => {
          if (!deleting) return;
          try {
            await deleteSet(deleting.id, Date.now());
          } catch (e) {
            if (e instanceof SessionEndedError) navigate({ name: 'home' });
            else throw e;
          }
        }}
        onClose=${() => setDeletingId(null)}
      />
    </main>
  `;
}
