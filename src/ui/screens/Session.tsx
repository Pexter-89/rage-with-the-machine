import { useEffect, useState } from 'react';
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

/** Optional body weight for the session: saved on Enter or when the field loses focus; emptying it clears it. */
function BodyweightField({ sessionId, saved, previous }: { sessionId: string; saved: number | null; previous: number | null }) {
  const show = (kg: number | null) => (kg === null ? '' : formatWeight(kg));
  const [text, setText] = useState(() => show(saved));
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const kg = text.trim() === '' ? null : parseWeightInput(text);
    if (kg !== null && !(kg > 0 && kg < 500)) {
      setText(show(saved));
      return;
    }
    if (kg === saved) {
      setText(show(saved));
      return;
    }
    try {
      await setSessionBodyweight(sessionId, kg);
      setText(show(kg));
      setError(null);
    } catch (e) {
      if (e instanceof SessionEndedError) navigate({ name: 'home' });
      else setError(oneLine(e));
    }
  }

  return (
    <>
      <label className="bodyweight">
        <span>BW</span>
        <input
          inputMode="decimal"
          aria-label="Body weight, kg"
          placeholder={previous === null ? '' : formatWeight(previous)}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
        <BodyweightField sessionId={sessionId} saved={session.bodyweight ?? null} previous={previousBodyweight} />
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
