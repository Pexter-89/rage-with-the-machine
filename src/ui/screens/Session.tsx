import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getCatalog } from '../../db/catalogRepo';
import {
  SessionEndedError,
  deleteExerciseSets,
  finishSession,
  lastBodyweight,
  sessionExercises,
  setSessionBodyweight,
} from '../../db/sessionRepo';
import { resolveItem } from '../../db/gymRepo';
import { formatTime } from '../../domain/dates';
import { parseWeightInput } from '../../domain/loading';
import { formatSummary, formatWeight, summarizeSets } from '../../domain/metrics';
import ConfirmSheet from '../components/ConfirmSheet';
import TopBar from '../components/TopBar';
import { oneLine } from '../lib/errors';
import { navigate, type Route } from '../router';

function formatElapsed(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/**
 * Optional body weight for the session: saved on Enter, when the field loses focus, when the screen is left or
 * `flush` is called (iOS Safari does not blur on a button tap); emptying it clears it.
 */
function BodyweightField({
  sessionId,
  saved,
  previous,
  flush,
}: {
  sessionId: string;
  saved: number | null;
  previous: number | null;
  flush: MutableRefObject<() => Promise<void>>;
}) {
  const show = (kg: number | null) => (kg === null ? '' : formatWeight(kg));
  const [text, setText] = useState(() => show(saved));
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef(text);
  const savedRef = useRef(saved);
  const mounted = useRef(true);
  savedRef.current = saved;

  function edit(value: string) {
    textRef.current = value;
    setText(value);
  }

  /** Saves the typed value if it is valid and changed; an invalid one reverts the field to the saved weight. */
  async function commit() {
    const raw = textRef.current;
    const kg = raw.trim() === '' ? null : parseWeightInput(raw);
    if (kg === null && raw.trim() !== '') {
      if (mounted.current) edit(show(savedRef.current));
      return;
    }
    if (kg !== null && !(kg > 0 && kg < 500)) {
      if (mounted.current) edit(show(savedRef.current));
      return;
    }
    if (kg === savedRef.current) {
      if (mounted.current) edit(show(savedRef.current));
      return;
    }
    try {
      await setSessionBodyweight(sessionId, kg);
      savedRef.current = kg;
      if (mounted.current) {
        edit(show(kg));
        setError(null);
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof SessionEndedError) navigate({ name: 'home' });
      else setError(oneLine(e));
    }
  }

  const commitRef = useRef(commit);
  commitRef.current = commit;
  flush.current = () => commitRef.current();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void commitRef.current();
    };
  }, []);

  return (
    <>
      <label className="bodyweight">
        <span>BW</span>
        <input
          inputMode="decimal"
          aria-label="Body weight, kg"
          placeholder={previous === null ? '' : formatWeight(previous)}
          value={text}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span>kg</span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export default function Session({ sessionId }: { sessionId: string }) {
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return null;
    const gym = await db.gyms.get(session.gymId);
    const catalog = await getCatalog();
    const exercises = await sessionExercises(sessionId);
    const cards = await Promise.all(
      exercises.map(async (ex) => {
        const item = await resolveItem(session.gymId, ex.key, catalog);
        const name = item?.name ?? catalog.find((c) => c.id === ex.catalogId)?.name ?? ex.catalogId;
        const summary = summarizeSets(ex.sets);
        return {
          key: ex.key,
          count: ex.sets.length,
          name,
          label: item?.label ?? '',
          summary: summary ? formatSummary(summary, ex.sets[0].unit) : '',
        };
      }),
    );
    return { session, gymName: gym?.name ?? '', cards, previousBodyweight: await lastBodyweight(sessionId) };
  }, [sessionId]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [removing, setRemoving] = useState<string | null>(null);
  const flushBodyweight = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (data === null) navigate({ name: 'home' });
  }, [data]);

  const route: Route = { name: 'session', sessionId };
  if (!data)
    return (
      <main className="screen session">
        <TopBar route={route} />
      </main>
    );
  const { session, gymName, cards, previousBodyweight } = data;
  const removingCard = cards.find((c) => c.key === removing);

  async function finish() {
    await flushBodyweight.current();
    await finishSession(sessionId, Date.now());
    navigate({ name: 'home' });
  }

  return (
    <main className="screen session">
      <TopBar route={route} title={gymName}>
        <button className="btn btn-quiet btn-small" aria-label="Finish session" onClick={finish}>
          Finish
        </button>
      </TopBar>
      <div className="session-meta">
        <p className="hint left">{`Started ${formatTime(session.startedAt)} · ${formatElapsed(now - session.startedAt)}`}</p>
        <BodyweightField sessionId={sessionId} saved={session.bodyweight ?? null} previous={previousBodyweight} flush={flushBodyweight} />
      </div>

      <ul className="list session-cards">
        {cards.map((c) => (
          <li key={c.key} className="split">
            <button className="btn card" onClick={() => navigate({ name: 'log', sessionId, key: c.key })}>
              <span className="card-name">{c.name}</span>
              {c.label && <span className="card-label">{c.label}</span>}
              <span className="card-summary">{c.summary}</span>
            </button>
            <button className="btn split-x" aria-label={`Delete ${c.name} sets`} onClick={() => setRemoving(c.key)}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      <button className="btn btn-big btn-primary" onClick={() => navigate({ name: 'pick', sessionId })}>
        ＋ Log exercise
      </button>

      <ConfirmSheet
        title="Delete exercise?"
        message={
          removingCard
            ? `${removingCard.name}: delete its ${removingCard.count} ${removingCard.count === 1 ? 'set' : 'sets'} from this session`
            : null
        }
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteExerciseSets(sessionId, removing, Date.now());
          } catch (e) {
            if (e instanceof SessionEndedError) navigate({ name: 'home' });
            else throw e;
          }
        }}
        onClose={() => setRemoving(null)}
      />
    </main>
  );
}
