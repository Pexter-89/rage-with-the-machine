import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getCatalog } from '../../db/catalogRepo';
import { finishSession, sessionExercises } from '../../db/sessionRepo';
import { resolveItem } from '../../db/gymRepo';
import { formatTime } from '../../domain/dates';
import { formatSummary, summarizeSets } from '../../domain/metrics';
import { navigate } from '../router';

function formatElapsed(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
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
          name,
          label: item?.label ?? '',
          summary: summary ? formatSummary(summary, ex.sets[0].unit) : '',
        };
      }),
    );
    return { session, gymName: gym?.name ?? '', cards };
  }, [sessionId]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (data === null) navigate({ name: 'home' });
  }, [data]);

  if (!data) return <main className="screen session" />;
  const { session, gymName, cards } = data;

  async function finish() {
    await finishSession(sessionId, Date.now());
    navigate({ name: 'home' });
  }

  return (
    <main className="screen session">
      <header className="bar">
        <h1 className="title">{gymName}</h1>
        <button className="btn btn-quiet btn-small" aria-label="Finish session" onClick={finish}>
          Finish
        </button>
      </header>
      <p className="hint">{`Started ${formatTime(session.startedAt)} · ${formatElapsed(now - session.startedAt)}`}</p>

      <ul className="list session-cards">
        {cards.map((c) => (
          <li key={c.key}>
            <button className="btn card" onClick={() => navigate({ name: 'log', sessionId, key: c.key })}>
              <span className="card-name">{c.name}</span>
              {c.label && <span className="card-label">{c.label}</span>}
              <span className="card-summary">{c.summary}</span>
            </button>
          </li>
        ))}
      </ul>

      <button className="btn btn-big btn-primary" onClick={() => navigate({ name: 'pick', sessionId })}>
        ＋ Log exercise
      </button>
    </main>
  );
}
