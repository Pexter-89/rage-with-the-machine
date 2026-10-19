import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getCatalog } from '../../db/catalogRepo';
import { availableExercises } from '../../db/gymRepo';
import { CATEGORIES } from '../../domain/catalog';
import { BodyIcon, EquipmentIcon } from '../components/Icons';
import ImportMachineSheet from '../components/ImportMachineSheet';
import TopBar from '../components/TopBar';
import { navigate, type Route } from '../router';

export default function Picker({ sessionId }: { sessionId: string }) {
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

  const route: Route = { name: 'pick', sessionId };
  if (!data)
    return (
      <main className="screen picker">
        <TopBar route={route} />
      </main>
    );

  const columns = CATEGORIES.map((c) => ({ ...c, items: data.items.filter((i) => i.category === c.id) })).filter(
    (c) => c.items.length > 0,
  );

  return (
    <main className="screen picker">
      <TopBar route={route} title={data.gymName}>
        <button className="btn btn-ghost btn-small" aria-label="Import machine" onClick={() => setImporting(true)}>
          Import
        </button>
      </TopBar>
      <div className="columns">
        {columns.map((c) => (
          <section key={c.id} className="column">
            <h2 className="column-title">
              <BodyIcon category={c.id} className="column-icon" />
              {c.name}
            </h2>
            <div className="column-items">
              {c.items.map((i) => (
                <button
                  key={i.key}
                  className="btn pick-item"
                  onClick={() => navigate({ name: 'log', sessionId, key: i.key })}
                >
                  <span className="pick-head">
                    <EquipmentIcon equipment={i.equipment} className="pick-icon" />
                    <span className="card-name">{i.name}</span>
                  </span>
                  {i.label && <span className="card-label">{i.label}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <button className="btn btn-ghost" onClick={() => navigate({ name: 'session', sessionId })}>
        ‹ Back
      </button>
      {importing && (
        <ImportMachineSheet
          gymId={data.gymId}
          onClose={() => setImporting(false)}
          onImported={(created) => {
            if (created.length === 1) navigate({ name: 'log', sessionId, key: created[0].id });
          }}
        />
      )}
    </main>
  );
}
