import { useState } from 'react';
import { deleteHistorySets, setHistoryBodyweight } from '../../db/sessionRepo.js';
import { parseWeightInput } from '../../domain/loading.js';
import { formatSet, formatWeight } from '../../domain/metrics.js';
import { oneLine } from '../lib/errors.js';
import Sheet from './Sheet.js';
import { html } from '../../lib/html.js';

/**
 * @typedef {object} Props
 * @property {string} title
 * @property {SetEntry[]} sets The sets to show; the sheet is closed when empty.
 * @property {((s: SetEntry) => string) | null} nameOf Exercise name per set, or null to leave it out (when the table is for one exercise).
 * @property {() => void} onClose
 * @property {(() => void) | null} [onSaveAsProgram] Shows "Save as program" (for one session's sets).
 * @property {string | null} [sessionId] The one session these sets belong to: shows its body weight, editable.
 * @property {number | null} [bodyweight] That session's body weight in kg, if noted.
 */

/**
 * A session's body weight with Edit (or Add): an in-page field, Save keeps it (decimal comma accepted), an
 * empty field clears it. Works on ended sessions too.
 * @param {{ sessionId: string, bodyweight: number | null }} props
 */
function BodyweightRow({ sessionId, bodyweight }) {
  const [text, setText] = useState(null); // null while not editing
  const [error, setError] = useState(null);

  async function save() {
    const raw = (text ?? '').trim();
    const kg = raw === '' ? null : parseWeightInput(raw);
    if (raw !== '' && (kg === null || !(kg > 0 && kg < 500))) {
      setError('Enter a body weight above 0 and below 500 kg, or leave it empty to clear it.');
      return;
    }
    try {
      await setHistoryBodyweight(sessionId, kg);
      setText(null);
      setError(null);
    } catch (e) {
      setError(oneLine(e));
    }
  }

  const shown = typeof bodyweight === 'number' ? `${formatWeight(bodyweight)} kg` : 'Not noted';
  return html`
    <div className="history-bw">
      ${
        text === null
          ? html`
          <div className="split">
            <span className="btn btn-left history-set">${`Body weight · ${shown}`}</span>
            <button
              className="btn btn-small"
              aria-label=${typeof bodyweight === 'number' ? 'Edit body weight' : 'Add body weight'}
              onClick=${() => setText(typeof bodyweight === 'number' ? formatWeight(bodyweight) : '')}
            >
              ${typeof bodyweight === 'number' ? 'Edit' : 'Add'}
            </button>
          </div>
        `
          : html`
          <form
            className="history-bw-edit"
            onSubmit=${(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="bodyweight">
              <span>BW</span>
              <input
                inputMode="decimal"
                aria-label="Body weight, kg"
                autoFocus
                value=${text}
                onChange=${(e) => setText(e.target.value)}
              />
              <span>kg</span>
            </label>
            <button type="submit" className="btn btn-small btn-primary">Save</button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick=${() => {
                setText(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </form>
        `
      }
      ${error && html`<p className="error" role="alert">${error}</p>`}
    </div>
  `;
}

/**
 * The sets behind one Progress row. Each ✕ (or Delete all) arms on the first tap and deletes on the second,
 * so a stray tap never removes history.
 * @param {Props} props
 */
export default function HistorySheet({
  title,
  sets,
  nameOf,
  onClose,
  onSaveAsProgram = null,
  sessionId = null,
  bodyweight = null,
}) {
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

  const text = (s) => `${nameOf ? `${nameOf(s)} · ` : ''}${formatSet(s)}`;

  return html`
    <${Sheet} open=${sets.length > 0} title=${title} onClose=${onClose}>
      ${sessionId && html`<${BodyweightRow} sessionId=${sessionId} bodyweight=${bodyweight} />`}
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
      ${
        onSaveAsProgram &&
        html`
        <button className="btn btn-ghost" onClick=${onSaveAsProgram}>
          Save as program
        </button>
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
