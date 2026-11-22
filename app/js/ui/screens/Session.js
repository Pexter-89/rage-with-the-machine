import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from '../../lib/useLiveQuery.js';
import { db } from '../../db/db.js';
import { getCatalog } from '../../db/catalogRepo.js';
import {
  SessionEndedError,
  deleteExerciseSets,
  finishSession,
  lastBodyweight,
  sessionExercises,
  setSessionBodyweight,
} from '../../db/sessionRepo.js';
import { resolveItem } from '../../db/gymRepo.js';
import { formatTime } from '../../domain/dates.js';
import { parseWeightInput } from '../../domain/loading.js';
import { formatSummary, formatWeight, summarizeSets } from '../../domain/metrics.js';
import ConfirmSheet from '../components/ConfirmSheet.js';
import TopBar from '../components/TopBar.js';
import { oneLine } from '../lib/errors.js';
import { navigate } from '../router.js';
import { Fragment, html } from '../../lib/html.js';

/**
 * @param {number} ms
 * @returns {string}
 */
function formatElapsed(ms) {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/**
 * Optional body weight for the session: saved on Enter, when the field loses focus, when the screen is left or
 * `flush` is called (iOS Safari does not blur on a button tap); emptying it clears it.
 * @param {{ sessionId: string, saved: number | null, previous: number | null, flush: MutableRefObject<() => Promise<void>> }} props
 */
function BodyweightField({ sessionId, saved, previous, flush }) {
  const show = (kg) => (kg === null ? '' : formatWeight(kg));
  const [text, setText] = useState(() => show(saved));
  const [error, setError] = useState(null);
  const textRef = useRef(text);
  const savedRef = useRef(saved);
  const mounted = useRef(true);
  savedRef.current = saved;

  function edit(value) {
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

  return html`
    <${Fragment}>
      <label className="bodyweight">
        <span>BW</span>
        <input
          inputMode="decimal"
          aria-label="Body weight, kg"
          placeholder=${previous === null ? '' : formatWeight(previous)}
          value=${text}
          onChange=${(e) => edit(e.target.value)}
          onBlur=${() => void commit()}
          onKeyDown=${(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span>kg</span>
      </label>
      ${
        error &&
        html`
        <p className="error" role="alert">
          ${error}
        </p>
      `
      }
    </${Fragment}>
  `;
}

/** @param {{ sessionId: string }} props */
export default function Session({ sessionId }) {
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

  const [removing, setRemoving] = useState(null);
  const flushBodyweight = useRef(async () => {});

  useEffect(() => {
    if (data === null) navigate({ name: 'home' });
  }, [data]);

  const route = { name: 'session', sessionId };
  if (!data)
    return html`
      <main className="screen session">
        <${TopBar} route=${route} />
      </main>
    `;
  const { session, gymName, cards, previousBodyweight } = data;
  const removingCard = cards.find((c) => c.key === removing);

  async function finish() {
    await flushBodyweight.current();
    await finishSession(sessionId, Date.now());
    navigate({ name: 'home' });
  }

  return html`
    <main className="screen session">
      <${TopBar} route=${route} title=${gymName}>
        <button className="btn btn-quiet btn-small" aria-label="Finish session" onClick=${finish}>
          Finish
        </button>
      </${TopBar}>
      <div className="session-meta">
        <p className="hint left">${`Started ${formatTime(session.startedAt)} · ${formatElapsed(now - session.startedAt)}`}</p>
        <${BodyweightField} sessionId=${sessionId} saved=${session.bodyweight ?? null} previous=${previousBodyweight} flush=${flushBodyweight} />
      </div>

      <ul className="list session-cards">
        ${cards.map(
          (c) =>
            html`
          <li key=${c.key} className="split">
            <button className="btn card" onClick=${() => navigate({ name: 'log', sessionId, key: c.key })}>
              <span className="card-name">${c.name}</span>
              ${c.label && html`<span className="card-label">${c.label}</span>`}
              <span className="card-summary">${c.summary}</span>
            </button>
            <button className="btn split-x" aria-label=${`Delete ${c.name} sets`} onClick=${() => setRemoving(c.key)}>
              ✕
            </button>
          </li>
        `,
        )}
      </ul>

      <button className="btn btn-big btn-primary" onClick=${() => navigate({ name: 'pick', sessionId })}>
        ＋ Log exercise
      </button>

      <${ConfirmSheet}
        title="Delete exercise?"
        message=${
          removingCard
            ? `${removingCard.name}: delete its ${removingCard.count} ${removingCard.count === 1 ? 'set' : 'sets'} from this session`
            : null
        }
        onConfirm=${async () => {
          if (!removing) return;
          try {
            await deleteExerciseSets(sessionId, removing, Date.now());
          } catch (e) {
            if (e instanceof SessionEndedError) navigate({ name: 'home' });
            else throw e;
          }
        }}
        onClose=${() => setRemoving(null)}
      />
    </main>
  `;
}
