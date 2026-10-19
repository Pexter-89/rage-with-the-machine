import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getCatalog } from '../../db/catalogRepo';
import { resolveItem } from '../../db/gymRepo';
import { SessionEndedError, addSet, deleteSet, getLastTime, prefill, setsForItem, updateSet } from '../../db/sessionRepo';
import type { LastTime } from '../../db/sessionRepo';
import { formatDate } from '../../domain/dates';
import { parseRepsInput, parseWeightInput, snapToWheel, wheelValues } from '../../domain/loading';
import { formatSummary, formatWeight, summarizeSets } from '../../domain/metrics';
import type { PickerItem, SetEntry } from '../../domain/types';
import ConfirmSheet from '../components/ConfirmSheet';
import PlatePicker from '../components/PlatePicker';
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
  | { status: 'ready'; item: PickerItem; sets: SetEntry[]; last: LastTime | null; lastGymName: string };

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
    const item = await resolveItem(session.gymId, itemKey, await getCatalog());
    if (!item) return { status: 'session' };
    const sets = await setsForItem(sessionId, item);
    const last = await getLastTime(item.catalogId, session.gymId, sessionId);
    const lastGym = last ? await db.gyms.get(last.gymId) : undefined;
    return { status: 'ready', item, sets, last, lastGymName: lastGym?.name ?? '' };
  }, [sessionId, itemKey]);

  // Computed once, when the data first loads; later live updates never overwrite the wheels.
  const [row, setRow] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pair = useRef<PairHandle>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
  const { item, sets, last, lastGymName } = data;

  if (!row) {
    const values = wheelValues(item.loading);
    const p = prefill(sets, last);
    setRow(
      p
        ? {
            // Snap only when the prefill came from last time; current-session sets keep typed values.
            weight: item.loading.type === 'stack' && sets.length === 0 ? snapToWheel(values, p.weight) : p.weight,
            reps: p.reps,
          }
        : { weight: values[0] ?? 0, reps: 10 },
    );
    return loadingScreen;
  }

  const lastSummary = last ? summarizeSets(last.sets) : null;
  const editing = sets.find((s) => s.id === editingId);
  const deleting = sets.find((s) => s.id === deletingId);

  async function complete() {
    if (inFlight.current || !row) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const v = pair.current?.flush() ?? row;
      await addSet(sessionId, item, v.weight, v.reps, Date.now());
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

      {last && lastSummary && (
        <div className="last-time">
          <div>{`Last time · ${formatDate(last.date)} · ${lastGymName}`}</div>
          <div className="card-summary">{formatSummary(lastSummary, last.sets[0].unit)}</div>
        </div>
      )}

      <div className="spacer" />

      <ol className="list done-sets">
        {sets.map((s, i) => (
          <li key={s.id} className="split">
            <button className="btn btn-left done-set" onClick={() => setEditingId(s.id)}>
              {`${i + 1}  ${setText(s)}`}
            </button>
            <button className="btn split-x" aria-label={`Delete set ${i + 1}`} onClick={() => setDeletingId(s.id)}>
              ✕
            </button>
          </li>
        ))}
      </ol>

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
