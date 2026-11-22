import { useState } from 'react';
import { deleteHistorySets } from '../../db/sessionRepo.js';
import { formatWeight } from '../../domain/metrics.js';
import { oneLine } from '../lib/errors.js';
import Sheet from './Sheet.js';
import { html } from '../../lib/html.js';

/**
 * @typedef {object} Props
 * @property {string} title
 * @property {SetEntry[]} sets The sets to show; the sheet is closed when empty.
 * @property {((s: SetEntry) => string) | null} nameOf Exercise name per set, or null to leave it out (when the table is for one exercise).
 * @property {() => void} onClose
 */

/**
 * The sets behind one Progress row. Each ✕ (or Delete all) arms on the first tap and deletes on the second,
 * so a stray tap never removes history.
 * @param {Props} props
 */
export default function HistorySheet({ title, sets, nameOf, onClose }) {
  const [armed, setArmed] = useState(null); // a set id, or 'all'
  const [error, setError] = useState(null);

  async function remove(ids) {
    try {
      await deleteHistorySets(ids);
      setArmed(null);
      setError(null);
    } catch (e) {
      setError(oneLine(e));
    }
  }

  const text = (s) =>
    `${nameOf ? `${nameOf(s)} · ` : ''}${formatWeight(s.weight)} ${s.unit === 'level' ? 'L' : 'kg'} × ${s.reps}`;

  return html`
    <${Sheet} open=${sets.length > 0} title=${title} onClose=${onClose}>
      <ul className="list history-sets">
        ${sets.map((s) => {
          const on = armed === s.id;
          return html`
            <li key=${s.id} className="split">
              <span className="btn btn-left history-set">${text(s)}</span>
              <button
                className=${'btn split-x' + (on ? ' btn-danger armed' : '')}
                aria-label=${on ? `Confirm delete ${text(s)}` : `Delete ${text(s)}`}
                onClick=${() => (on ? void remove([s.id]) : setArmed(s.id))}
              >
                ${on ? 'Delete' : '✕'}
              </button>
            </li>
          `;
        })}
      </ul>
      ${
        error &&
        html`
        <p className="error" role="alert">
          ${error}
        </p>
      `
      }
      <div className="nav-row">
        <button className="btn btn-ghost" onClick=${onClose}>
          Close
        </button>
        <button
          className=${'btn ' + (armed === 'all' ? 'btn-danger' : 'btn-ghost')}
          onClick=${() => (armed === 'all' ? void remove(sets.map((s) => s.id)) : setArmed('all'))}
        >
          ${armed === 'all' ? `Tap again to delete ${sets.length}` : `Delete all ${sets.length}`}
        </button>
      </div>
    </${Sheet}>
  `;
}
