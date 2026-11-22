import { useEffect, useState } from 'react';
import { useLiveQuery } from '../../lib/useLiveQuery.js';
import { db } from '../../db/db.js';
import { getCatalog } from '../../db/catalogRepo.js';
import { availableExercises } from '../../db/gymRepo.js';
import ImportMachineSheet from '../components/ImportMachineSheet.js';
import PickerColumns from '../components/PickerColumns.js';
import TopBar from '../components/TopBar.js';
import { navigate } from '../router.js';
import { html } from '../../lib/html.js';

/** @param {{ sessionId: string }} props */
export default function Picker({ sessionId }) {
  const [importing, setImporting] = useState(false);
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return null;
    const gym = await db.gyms.get(session.gymId);
    const items = await availableExercises(session.gymId, await getCatalog());
    return { gymId: session.gymId, gymName: gym?.name ?? '', items };
  }, [sessionId]);

  useEffect(() => {
    if (data === null) navigate({ name: 'home' });
  }, [data]);

  const route = { name: 'pick', sessionId };
  if (!data)
    return html`
      <main className="screen picker">
        <${TopBar} route=${route} />
      </main>
    `;

  return html`
    <main className="screen picker">
      <${TopBar} route=${route} title=${data.gymName}>
        <button className="btn btn-ghost btn-small" aria-label="Import machine" onClick=${() => setImporting(true)}>
          Import
        </button>
      </${TopBar}>
      <${PickerColumns} items=${data.items} onPick=${(i) => navigate({ name: 'log', sessionId, key: i.key })} />
      <button className="btn btn-ghost" onClick=${() => navigate({ name: 'session', sessionId })}>
        ‹ Back
      </button>
      ${
        importing &&
        html`
        <${ImportMachineSheet}
          gymId=${data.gymId}
          onClose=${() => setImporting(false)}
          onImported=${(created) => {
            if (created.length === 1) navigate({ name: 'log', sessionId, key: created[0].id });
          }}
        />
      `
      }
    </main>
  `;
}
