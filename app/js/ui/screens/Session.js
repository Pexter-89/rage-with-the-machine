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
import { swapPlanItem } from '../../db/programRepo.js';
import { equipmentOf } from '../../domain/catalog.js';
import { formatDate, formatTime } from '../../domain/dates.js';
import { parseWeightInput } from '../../domain/loading.js';
import { formatSummary, formatWeight, summarizeSets } from '../../domain/metrics.js';
import { formatTarget, planProgress, resolveAt, swapAlternatives } from '../../domain/programs.js';
import ConfirmSheet from '../components/ConfirmSheet.js';
import { EquipmentIcon } from '../components/Icons.js';
import SaveProgramSheet from '../components/SaveProgramSheet.js';
import Sheet from '../components/Sheet.js';
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

/**
 * The session's plan as to-do cards: for each item, this gym's machine for it (or why there is none), the
 * target and how many sets are logged.
 * @param {Session} session
 * @param {CatalogExercise[]} catalog
 * @returns {Promise<PlanCard[] | null>}
 */
async function planCards(session, catalog) {
  const plan = session.plan;
  if (!plan) return null;
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const [mine, sessionSets] = await Promise.all([
    db.gymExercises.where('gymId').equals(session.gymId).toArray(),
    db.sets.where('sessionId').equals(session.id).toArray(),
  ]);
  const progress = planProgress(plan, sessionSets);
  return Promise.all(
    plan.map(async (p, index) => {
      const entry = byId.get(p.catalogId);
      // "Last used at this gym" needs this exercise's sets from every session, this one included.
      const history = await db.sets.where('catalogId').equals(p.catalogId).toArray();
      const a = resolveAt(entry, mine, history, session.gymId);
      const machine = a.key ? mine.find((m) => m.id === a.key) : undefined;
      return {
        index,
        catalogId: p.catalogId,
        name: entry?.name ?? p.catalogId,
        label: machine?.label ?? '',
        sets: p.sets,
        target: formatTarget(p),
        done: progress[index].done,
        ticked: progress[index].ticked,
        status: a.status,
        key: a.key,
        machines: a.machines.map((m) => ({ id: m.id, label: m.label || entry?.name || '' })),
        alternatives: entry
          ? swapAlternatives(
              entry,
              catalog,
              mine,
              plan.map((x) => x.catalogId),
            ).map((e) => ({ id: e.id, name: e.name, equipment: equipmentOf(e) }))
          : [],
      };
    }),
  );
}

/**
 * @typedef {object} PlanCard
 * @property {number} index
 * @property {string} catalogId
 * @property {string} name
 * @property {string} label
 * @property {number} sets
 * @property {string} target
 * @property {number} done
 * @property {boolean} ticked
 * @property {'available' | 'choose' | 'missing'} status
 * @property {string | null} key
 * @property {{ id: string, label: string }[]} machines
 * @property {{ id: string, name: string, equipment: Equipment }[]} alternatives
 */

/** @param {{ sessionId: string }} props */
export default function Session({ sessionId }) {
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return null;
    const gym = await db.gyms.get(session.gymId);
    const catalog = await getCatalog();
    const exercises = await sessionExercises(sessionId);
    const plan = await planCards(session, catalog);
    // Only the key a plan card resolves to is covered by the plan; other machines show as extras.
    const planned = new Set((plan ?? []).map((c) => c.key).filter(Boolean));
    const cards = await Promise.all(
      exercises
        .filter((ex) => !planned.has(ex.key))
        .map(async (ex) => {
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
    const program = session.programId ? await db.programs.get(session.programId) : undefined;
    return {
      session,
      gymName: gym?.name ?? '',
      cards,
      plan,
      programName: program?.name ?? null,
      logged: exercises.length > 0,
      previousBodyweight: await lastBodyweight(sessionId),
    };
  }, [sessionId]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [removing, setRemoving] = useState(null);
  /** Plan index whose exercise is being swapped, or whose machine is being chosen. */
  const [swapping, setSwapping] = useState(null);
  const [choosing, setChoosing] = useState(null);
  const [savingAs, setSavingAs] = useState(false);
  const [saved, setSaved] = useState(null);
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
  const { session, gymName, cards, plan, programName, logged, previousBodyweight } = data;
  const removingCard = cards.find((c) => c.key === removing);
  const swapCard = plan?.find((c) => c.index === swapping);
  const chooseCard = plan?.find((c) => c.index === choosing);

  /** @param {PlanCard} c */
  function openPlanned(c) {
    if (c.status === 'available' && c.key) navigate({ name: 'log', sessionId, key: c.key });
    else if (c.status === 'choose') setChoosing(c.index);
    else setSwapping(c.index);
  }

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

      <div className="session-cards">
        ${
          plan &&
          html`
          <${Fragment}>
            <h2 className="section-title">${programName ?? 'Plan'}</h2>
            <ul className="list plan-list" aria-label="Plan">
              ${plan.map(
                (c) => html`
                  <li key=${c.index} className=${'split plan-item' + (c.ticked ? ' done' : '') + (c.status === 'missing' ? ' missing' : '')}>
                    <button className="btn card" aria-label=${`${c.name}, ${c.done} of ${c.sets} sets${c.ticked ? ', done' : ''}`} onClick=${() => openPlanned(c)}>
                      <span className="plan-head">
                        <span className="plan-check" aria-hidden="true">${c.ticked ? '✓' : ''}</span>
                        <span className="card-name">${c.name}</span>
                      </span>
                      ${c.label && html`<span className="card-label">${c.label}</span>`}
                      <span className="card-summary">
                        ${c.status === 'missing' ? `Not at this gym · ${c.target}` : `${c.target} · ${c.done}/${c.sets}`}
                      </span>
                    </button>
                    ${
                      c.status === 'missing' &&
                      html`
                      <button className="btn split-x split-swap" aria-label=${`Swap ${c.name}`} onClick=${() => setSwapping(c.index)}>
                        Swap
                      </button>
                    `
                    }
                  </li>
                `,
              )}
            </ul>
            ${cards.length > 0 && html`<h2 className="section-title">Extra</h2>`}
          </${Fragment}>
        `
        }
        <ul className="list">
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
      </div>

      <button className="btn btn-big btn-primary" onClick=${() => navigate({ name: 'pick', sessionId })}>
        ＋ Log exercise
      </button>
      ${
        logged &&
        html`
        <button className="btn btn-ghost" onClick=${() => setSavingAs(true)}>
          Save as program
        </button>
      `
      }
      ${saved && html`<p className="hint" role="status">${`Saved as program “${saved}”`}</p>`}

      <${Sheet} open=${!!swapCard} title=${swapCard ? `Swap ${swapCard.name}` : 'Swap'} onClose=${() => setSwapping(null)}>
        ${
          swapCard &&
          html`
          <${Fragment}>
            <p className="hint">
              ${swapCard.status === 'missing' ? 'Not at this gym. ' : ''}Same muscle group, available here. Keeps ${swapCard.target}.
            </p>
            ${swapCard.alternatives.length === 0 && html`<p className="hint">Nothing in this group here. Skip it, or log something else.</p>`}
            <ul className="list swap-list">
              ${swapCard.alternatives.map(
                (a) => html`
                  <li key=${a.id}>
                    <button
                      className="btn btn-left swap-option"
                      onClick=${async () => {
                        await swapPlanItem(sessionId, swapCard.index, a.id);
                        setSwapping(null);
                      }}
                    >
                      <${EquipmentIcon} equipment=${a.equipment} className="pick-icon" />
                      <span>${a.name}</span>
                    </button>
                  </li>
                `,
              )}
            </ul>
            <button className="btn btn-ghost" onClick=${() => setSwapping(null)}>Cancel</button>
          </${Fragment}>
        `
        }
      </${Sheet}>
      <${Sheet} open=${!!chooseCard} title=${chooseCard ? `Which ${chooseCard.name}?` : 'Which machine?'} onClose=${() => setChoosing(null)}>
        ${
          chooseCard &&
          html`
          <${Fragment}>
            <p className="hint">This gym has several. The one you log on is picked next time.</p>
            <ul className="list">
              ${chooseCard.machines.map(
                (m) => html`
                  <li key=${m.id}>
                    <button className="btn btn-left swap-option" onClick=${() => navigate({ name: 'log', sessionId, key: m.id })}>
                      ${m.label}
                    </button>
                  </li>
                `,
              )}
            </ul>
          </${Fragment}>
        `
        }
      </${Sheet}>
      <${SaveProgramSheet}
        sessionId=${savingAs ? sessionId : null}
        defaultName=${`${gymName} ${formatDate(session.startedAt)}`.trim()}
        onClose=${() => setSavingAs(false)}
        onSaved=${(p) => setSaved(p.name)}
      />

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
