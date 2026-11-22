import { useEffect, useState } from 'react';
import { saveSessionAsProgram } from '../../db/programRepo.js';
import { oneLine } from '../lib/errors.js';
import Sheet from './Sheet.js';
import { html } from '../../lib/html.js';

/**
 * "Save as program": asks for a name (prefilled) and saves the session's exercises as a new program.
 * @param {{ sessionId: string | null, defaultName: string, onClose: () => void, onSaved?: (p: Program) => void }} props
 */
export default function SaveProgramSheet({ sessionId, defaultName, onClose, onSaved }) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sessionId) {
      setName(defaultName);
      setError(null);
    }
  }, [sessionId, defaultName]);

  async function save() {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const p = await saveSessionAsProgram(sessionId, name, Date.now());
      onSaved?.(p);
      onClose();
    } catch (e) {
      setError(oneLine(e));
    } finally {
      setBusy(false);
    }
  }

  return html`
    <${Sheet} open=${!!sessionId} title="Save as program" onClose=${onClose}>
      <p className="hint">The exercises in the order you did them, with the sets and typical reps you logged.</p>
      <form
        className="inline-form"
        onSubmit=${(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input aria-label="Program name" value=${name} onChange=${(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled=${busy || !name.trim()}>Save</button>
      </form>
      ${
        error &&
        html`
        <p className="error" role="alert">
          ${error}
        </p>
      `
      }
      <button className="btn btn-ghost" onClick=${onClose}>Cancel</button>
    </${Sheet}>
  `;
}
