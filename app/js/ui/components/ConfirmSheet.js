import { useState } from 'react';
import { oneLine } from '../lib/errors.js';
import Sheet from './Sheet.js';
import { html } from '../../lib/html.js';

/**
 * @typedef {object} Props
 * @property {string | null} message Shown when non-null; the text explains what will be deleted.
 * @property {string} [title]
 * @property {string} [confirmLabel]
 * @property {() => Promise<void> | void} onConfirm
 * @property {() => void} onClose
 */

/**
 * "Are you sure?" sheet for deletions. Closes after a successful confirm; a failure shows inline.
 * @param {Props} props
 */
export default function ConfirmSheet({ message, title = 'Delete?', confirmLabel = 'Delete', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      setError(null);
      onClose();
    } catch (e) {
      setError(oneLine(e));
    } finally {
      setBusy(false);
    }
  }

  return html`
    <${Sheet}
      open=${message !== null}
      title=${title}
      onClose=${() => {
        setError(null);
        onClose();
      }}
    >
      <p className="confirm-text">${message}</p>
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
          Cancel
        </button>
        <button className="btn btn-danger" disabled=${busy} onClick=${() => void confirm()}>
          ${confirmLabel}
        </button>
      </div>
    </${Sheet}>
  `;
}
