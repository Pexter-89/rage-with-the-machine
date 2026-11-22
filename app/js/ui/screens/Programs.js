import { useState } from 'react';
import { useLiveQuery } from '../../lib/useLiveQuery.js';
import { getCatalog } from '../../db/catalogRepo.js';
import { db } from '../../db/db.js';
import { listPrograms, moveProgram, startProgramSession } from '../../db/programRepo.js';
import { getSettings } from '../../db/settingsRepo.js';
import { programAvailability } from '../../domain/programs.js';
import TopBar from '../components/TopBar.js';
import { oneLine } from '../lib/errors.js';
import { navigate } from '../router.js';
import { Fragment, html } from '../../lib/html.js';

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * A gym's program list (from the right half of the gym's button on Home): tap a program to start a session
 * from it here; each says how many of its exercises this gym lacks.
 * @param {{ gymId: string }} props
 */
export default function Programs({ gymId }) {
  const [error, setError] = useState(null);
  const data = useLiveQuery(async () => {
    const [gym, programs, catalog, mine] = await Promise.all([
      db.gyms.get(gymId),
      listPrograms(),
      getCatalog(),
      db.gymExercises.where('gymId').equals(gymId).toArray(),
    ]);
    const byId = new Map(catalog.map((e) => [e.id, e]));
    return {
      gymName: gym?.name ?? '',
      rows: programs.map((p) => ({ program: p, ...programAvailability(p.items, byId, mine) })),
    };
  }, [gymId]);

  const route = { name: 'programs', gymId };
  if (!data)
    return html`
      <main className="screen">
        <${TopBar} route=${route} title="Programs" />
      </main>
    `;

  async function start(programId) {
    try {
      const settings = await getSettings();
      const s = await startProgramSession(gymId, programId, Date.now(), settings.autoCloseMinutes);
      navigate({ name: 'session', sessionId: s.id });
    } catch (e) {
      setError(oneLine(e));
    }
  }

  const { rows } = data;
  return html`
    <main className="screen">
      <${TopBar} route=${route} title=${data.gymName ? `Programs · ${data.gymName}` : 'Programs'} />
      ${rows.length === 0 && html`<p className="hint">No programs yet. Make one, or save a session as a program.</p>`}
      ${rows.length > 0 && html`<p className="hint">Tap a program to start it here.</p>`}
      <ul className="list">
        ${rows.map(
          ({ program: p, count: n, missing }, i) => html`
            <li key=${p.id} className="row" data-testid="program-row">
              <button
                className="btn btn-primary btn-left grow program-start"
                aria-label=${`Start ${p.name}`}
                onClick=${() => void start(p.id)}
              >
                <span className="card-name">▶ ${p.name}</span>
                <span className="program-meta">
                  ${count(n, 'exercise', 'exercises')}
                  ${
                    missing > 0 &&
                    html`
                    <${Fragment}>
                      ${' · '}
                      <span className="program-missing">${missing} not at this gym</span>
                    </${Fragment}>
                  `
                  }
                </span>
              </button>
              <div className="actions">
                <button
                  className="btn btn-ghost btn-icon"
                  aria-label=${`Move ${p.name} up`}
                  disabled=${i === 0}
                  onClick=${() => moveProgram(p.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  aria-label=${`Move ${p.name} down`}
                  disabled=${i === rows.length - 1}
                  onClick=${() => moveProgram(p.id, 1)}
                >
                  ↓
                </button>
                <button
                  className="btn btn-ghost btn-small grow-btn"
                  aria-label=${`Edit ${p.name}`}
                  onClick=${() => navigate({ name: 'program', gymId, programId: p.id })}
                >
                  Edit
                </button>
              </div>
            </li>
          `,
        )}
      </ul>
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
        <button className="btn btn-primary" onClick=${() => navigate({ name: 'program', gymId, programId: 'new' })}>
          ＋ New program
        </button>
      </div>
    </main>
  `;
}
