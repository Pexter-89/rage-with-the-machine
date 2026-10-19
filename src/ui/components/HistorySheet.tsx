import { useState } from 'react';
import { deleteHistorySets } from '../../db/sessionRepo';
import { formatWeight } from '../../domain/metrics';
import type { SetEntry } from '../../domain/types';
import { oneLine } from '../lib/errors';
import Sheet from './Sheet';

interface Props {
  title: string;
  /** The sets to show; the sheet is closed when empty. */
  sets: SetEntry[];
  /** Exercise name per set, or null to leave it out (when the table is for one exercise). */
  nameOf: ((s: SetEntry) => string) | null;
  onClose(): void;
}

/**
 * The sets behind one Progress row. Each ✕ (or Delete all) arms on the first tap and deletes on the second,
 * so a stray tap never removes history.
 */
export default function HistorySheet({ title, sets, nameOf, onClose }: Props) {
  const [armed, setArmed] = useState<string | null>(null); // a set id, or 'all'
  const [error, setError] = useState<string | null>(null);

  async function remove(ids: string[]) {
    try {
      await deleteHistorySets(ids);
      setArmed(null);
      setError(null);
    } catch (e) {
      setError(oneLine(e));
    }
  }

  const text = (s: SetEntry) =>
    `${nameOf ? `${nameOf(s)} · ` : ''}${formatWeight(s.weight)} ${s.unit === 'level' ? 'L' : 'kg'} × ${s.reps}`;

  return (
    <Sheet open={sets.length > 0} title={title} onClose={onClose}>
      <ul className="list history-sets">
        {sets.map((s) => {
          const on = armed === s.id;
          return (
            <li key={s.id} className="split">
              <span className="btn btn-left history-set">{text(s)}</span>
              <button
                className={'btn split-x' + (on ? ' btn-danger armed' : '')}
                aria-label={on ? `Confirm delete ${text(s)}` : `Delete ${text(s)}`}
                onClick={() => (on ? void remove([s.id]) : setArmed(s.id))}
              >
                {on ? 'Delete' : '✕'}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="nav-row">
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        <button
          className={'btn ' + (armed === 'all' ? 'btn-danger' : 'btn-ghost')}
          onClick={() => (armed === 'all' ? void remove(sets.map((s) => s.id)) : setArmed('all'))}
        >
          {armed === 'all' ? `Tap again to delete ${sets.length}` : `Delete all ${sets.length}`}
        </button>
      </div>
    </Sheet>
  );
}
