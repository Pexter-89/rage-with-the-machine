import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getCatalog } from '../../db/catalogRepo';
import { resolveItem, setGymExerciseNotes } from '../../db/gymRepo';
import {
  SessionEndedError,
  addSet,
  deleteSet,
  getLastTime,
  prefill,
  recordHistory,
  setsForItem,
  updateSet,
} from '../../db/sessionRepo';
import type { LastTime } from '../../db/sessionRepo';
import { formatDate } from '../../domain/dates';
import { parseRepsInput, parseWeightInput, reachableValues, snapToWheel, wheelValues } from '../../domain/loading';
import { formatSetList, formatWeight, recordSetIds } from '../../domain/metrics';
import type { PickerItem, SetEntry } from '../../domain/types';
import ConfirmSheet from '../components/ConfirmSheet';
import AddOnStack from '../components/AddOnStack';
import PlatePicker from '../components/PlatePicker';
import RestTimer from '../components/RestTimer';
import Sheet from '../components/Sheet';
import TopBar from '../components/TopBar';
import Wheel from '../components/Wheel';
import type { WheelHandle } from '../components/Wheel';
import { oneLine } from '../lib/errors';
import { navigate, type Route } from '../router';

const REPS = Array.from({ length: 50 }, (_, i) => i + 1);

type Loaded =
  | { status: 'home' }
  | { status: 'session' }
  | {
      status: 'ready';
      item: PickerItem;
      sets: SetEntry[];
      last: LastTime | null;
      lastGymName: string;
      /** Earlier sessions' sets that records are measured against; empty when records do not apply. */
      history: SetEntry[];
    };

interface Row {
  weight: number;
  reps: number;
}

function weightLabel(item: PickerItem): string {
  if (item.assisted) return 'ASSIST KG';
  if (item.loading.type === 'stack' && item.loading.unit === 'level') return 'LEVEL';
  if (item.loading.type === 'bodyweight') return '+KG';
  return 'KG';
}

const isLevel = (item: PickerItem) => item.loading.type === 'stack' && item.loading.unit === 'level';

interface PairProps {
  item: PickerItem;
  row: Row;
  onChange(update: (r: Row) => Row): void;
}

interface PairHandle {
  flush(): Row;
}

const WheelPair = forwardRef<PairHandle, PairProps>(function WheelPair({ item, row, onChange }, ref) {
  const w = useRef<WheelHandle>(null);
  const r = useRef<WheelHandle>(null);
  useImperativeHandle(ref, () => ({
    flush: () => ({ weight: w.current?.flush() ?? row.weight, reps: r.current?.flush() ?? row.reps }),
  }));
  const setWeight = (weight: number) => onChange((r) => ({ ...r, weight }));
  return (
    <>
      {item.loading.type === 'plates' && !item.assisted ? (
        <PlatePicker ref={w} loading={item.loading} value={row.weight} onChange={setWeight} />
      ) : item.loading.type === 'stack' && item.loading.unit !== 'level' && item.loading.addOns?.length ? (
        <AddOnStack
          ref={w}
          label={item.assisted ? 'STACK ASSIST KG' : 'STACK KG'}
          weights={wheelValues(item.loading)}
          addOns={item.loading.addOns}
          value={row.weight}
          onChange={setWeight}
        />
      ) : (
        <Wheel
          ref={w}
          label={weightLabel(item)}
          values={wheelValues(item.loading)}
          value={row.weight}
          onChange={setWeight}
          parse={parseWeightInput}
          suffix={isLevel(item) ? 'L' : undefined}
        />
      )}
      <Wheel
        ref={r}
        label={item.unilateral ? 'REPS / SIDE' : 'REPS'}
        values={REPS}
        value={row.reps}
        onChange={(reps) => onChange((r) => ({ ...r, reps }))}
        parse={parseRepsInput}
      />
    </>
  );
});

/** The next row's values; a stack snaps values taken from last time onto what this machine can make. */
function nextRow(item: PickerItem, sets: SetEntry[], last: LastTime | null): (Row & { fromLast: boolean }) | null {
  const p = prefill(sets, last);
  if (!p) return null;
  const snap = p.snap && item.loading.type === 'stack';
  return { ...p, weight: snap ? snapToWheel(reachableValues(item.loading), p.weight) : p.weight };
}

function NoteSheet({ id, notes, onClose }: { id: string; notes: string; onClose(): void }) {
  const [text, setText] = useState(notes);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      await setGymExerciseNotes(id, text);
      onClose();
    } catch (e) {
      setError(oneLine(e));
    }
  }
  return (
    <>
      <textarea
        rows={4}
        aria-label="Machine note"
        placeholder="Seat height, pin positions…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" onClick={() => void save()}>
        Save
      </button>
    </>
  );
}

/** A failed write shows one line inline; a write into a session that has ended goes home. */
function writeFailed(e: unknown, show: (text: string) => void): void {
  if (e instanceof SessionEndedError) navigate({ name: 'home' });
  else show(oneLine(e));
}

function EditSheet({ item, set, onClose }: { item: PickerItem; set: SetEntry; onClose(): void }) {
  const [row, setRow] = useState<Row>({ weight: set.weight, reps: set.reps });
  const [error, setError] = useState<string | null>(null);
  const pair = useRef<PairHandle>(null);

  async function run(write: () => Promise<void>) {
    try {
      await write();
      onClose();
    } catch (e) {
      writeFailed(e, setError);
    }
  }

  return (
    <>
      <div className="input-row">
        <WheelPair ref={pair} item={item} row={row} onChange={setRow} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="nav-row">
        <button
          className="btn btn-primary"
          onClick={() => void run(() => updateSet(set.id, pair.current?.flush() ?? row, Date.now()))}
        >
          Save
        </button>
        <button className="btn" onClick={() => void run(() => deleteSet(set.id, Date.now()))}>
          Delete
        </button>
      </div>
    </>
  );
}

export default function Logging({ sessionId, itemKey }: { sessionId: string; itemKey: string }) {
  const data = useLiveQuery<Loaded>(async () => {
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
      kind === 'bodyweight' || item.assisted ? [] : await recordHistory(item, kind === 'machine', sessionId);
    return { status: 'ready', item, sets, last, lastGymName: lastGym?.name ?? '', history };
  }, [sessionId, itemKey]);

  // Computed once, when the data first loads; later live updates never overwrite the wheels.
  const [row, setRow] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pair = useRef<PairHandle>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** When the last set was completed on this screen; leaving the screen drops the timer. */
  const [restSince, setRestSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.status === 'home') navigate({ name: 'home' });
    else if (data?.status === 'session') navigate({ name: 'session', sessionId });
  }, [data, sessionId]);

  const route: Route = { name: 'log', sessionId, key: itemKey };
  const loadingScreen = (
    <main className="screen logging">
      <TopBar route={route} />
    </main>
  );
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

  const setText = (s: SetEntry) =>
    s.unit === 'level'
      ? `${formatWeight(s.weight)} L × ${s.reps}`
      : `${formatWeight(s.weight)} kg × ${s.reps}`;

  return (
    <main className="screen logging">
      <TopBar route={route} title={item.name} />
      {item.label && <p className="hint">{item.label}</p>}
      {item.gymExerciseId && (
        <button
          className={item.notes ? 'btn btn-quiet machine-note' : 'btn btn-quiet btn-small machine-note'}
          aria-label={item.notes ? `Machine note: ${item.notes}` : 'Add machine note'}
          onClick={() => setEditingNote(true)}
        >
          {item.notes || '＋ Note'}
        </button>
      )}

      {last && last.sets.length > 0 && (
        <div className="last-time">
          <div>{`Last time · ${formatDate(last.date)} · ${lastGymName}`}</div>
          <div className="last-sets">{formatSetList(last.sets)}</div>
        </div>
      )}

      <div className="spacer" />

      <ol className="list done-sets">
        {sets.map((s, i) => (
          <li key={s.id} className="split">
            <button className="btn btn-left done-set" onClick={() => setEditingId(s.id)}>
              {`${i + 1}  ${setText(s)}`}
              {records.has(s.id) && (
                <>
                  {' '}
                  <span className="record">PR</span>
                </>
              )}
            </button>
            <button className="btn split-x" aria-label={`Delete set ${i + 1}`} onClick={() => setDeletingId(s.id)}>
              ✕
            </button>
          </li>
        ))}
      </ol>

      <RestTimer since={restSince} />

      <div className="input-row">
        <WheelPair ref={pair} item={item} row={row} onChange={(u) => setRow((r) => (r ? u(r) : r))} />
        <button className="btn btn-ok btn-complete" aria-label="Complete set" disabled={busy} onClick={complete}>
          ✓
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button className="btn btn-ghost" onClick={() => navigate({ name: 'session', sessionId })}>
        ‹ Back to session
      </button>

      <Sheet open={editingNote} title="Machine note" onClose={() => setEditingNote(false)}>
        {editingNote && item.gymExerciseId && (
          <NoteSheet id={item.gymExerciseId} notes={item.notes} onClose={() => setEditingNote(false)} />
        )}
      </Sheet>
      <Sheet open={!!editing} title="Edit set" onClose={() => setEditingId(null)}>
        {editing && <EditSheet key={editing.id} item={item} set={editing} onClose={() => setEditingId(null)} />}
      </Sheet>
      <ConfirmSheet
        title="Delete set?"
        message={deleting ? `Set ${sets.indexOf(deleting) + 1}: ${setText(deleting)}` : null}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteSet(deleting.id, Date.now());
          } catch (e) {
            if (e instanceof SessionEndedError) navigate({ name: 'home' });
            else throw e;
          }
        }}
        onClose={() => setDeletingId(null)}
      />
    </main>
  );
}
