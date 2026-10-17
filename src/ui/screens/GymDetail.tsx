import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getCatalog } from '../../db/catalogRepo';
import { db } from '../../db/db';
import { listGymMachines, saveGymExercise } from '../../db/gymRepo';
import { CATEGORIES } from '../../domain/catalog';
import type { CatalogExercise } from '../../domain/types';
import ImportMachineSheet from '../components/ImportMachineSheet';
import { navigate } from '../router';

export default function GymDetail({ gymId }: { gymId: string }) {
  const [importing, setImporting] = useState<null | { file?: File }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const data = useLiveQuery(async () => {
    const gym = await db.gyms.get(gymId);
    const [catalog, machines, mine] = await Promise.all([
      getCatalog(),
      listGymMachines(gymId),
      db.gymExercises.where('gymId').equals(gymId).toArray(),
    ]);
    return { gym, catalog, machines, mine };
  }, [gymId]);

  if (!data) return <main className="screen" />;
  const { gym, catalog, machines, mine } = data;
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const freeLike = catalog.filter((e) => (e.kind === 'free' || e.kind === 'bodyweight') && e.defaultLoading);
  const overrideOf = (e: CatalogExercise) => mine.find((ge) => ge.catalogId === e.id);

  async function toggleHidden(e: CatalogExercise) {
    const o = overrideOf(e);
    if (o) await db.gymExercises.update(o.id, { hidden: !o.hidden });
    else await saveGymExercise({ gymId, catalogId: e.id, label: '', notes: '', loading: e.defaultLoading!, hidden: true });
  }

  function openFreeEditor(e: CatalogExercise) {
    const o = overrideOf(e);
    navigate(o ? { name: 'exercise', gymId, geId: o.id } : { name: 'exercise', gymId, geId: 'new', catalogId: e.id });
  }

  return (
    <main className="screen">
      <header className="bar">
        <button className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'gyms' })}>
          ‹ Gyms
        </button>
        <h1 className="title">{gym?.name ?? ''}</h1>
      </header>

      <h2 className="section-title">Machines</h2>
      {machines.length === 0 && <p className="hint">No machines yet. Import a file from Claude or add one manually.</p>}
      <ul className="list">
        {machines.map((ge) => {
          const name = byId.get(ge.catalogId)?.name ?? ge.catalogId;
          return (
            <li key={ge.id}>
              <button
                className="btn btn-primary btn-left grow"
                onClick={() => navigate({ name: 'exercise', gymId, geId: ge.id })}
              >
                <span>{ge.label ? `${name} — ${ge.label}` : name}</span>
                {ge.hidden && <span className="tag">Hidden</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <h2 className="section-title">Free weights &amp; bodyweight</h2>
      {CATEGORIES.map((c) => {
        const inCat = freeLike.filter((e) => e.category === c.id);
        if (inCat.length === 0) return null;
        return (
          <section key={c.id}>
            <h3 className="column-title">{c.name}</h3>
            <ul className="list">
              {inCat.map((e) => {
                const hidden = overrideOf(e)?.hidden ?? false;
                return (
                  <li key={e.id} className={'row free-row' + (hidden ? ' archived' : '')}>
                    <button className="btn btn-ghost btn-left grow" onClick={() => openFreeEditor(e)}>
                      {e.name}
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      aria-label={`${hidden ? 'Show' : 'Hide'} ${e.name} here`}
                      aria-pressed={hidden}
                      onClick={() => void toggleHidden(e)}
                    >
                      {hidden ? 'Show here' : 'Hide here'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="bottom-actions">
        <input
          ref={fileRef}
          type="file"
          hidden
          aria-label="Machine file"
          accept=".json,.md,.txt,application/json,text/plain,text/markdown"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setImporting({ file });
          }}
        />
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
          Import machine file
        </button>
        <button className="btn btn-ghost" onClick={() => setImporting({})}>
          Paste from Claude
        </button>
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'exercise', gymId, geId: 'new' })}>
          Add manually
        </button>
      </div>

      {importing && (
        <ImportMachineSheet
          gymId={gymId}
          initialFile={importing.file}
          onClose={() => setImporting(null)}
          onImported={() => {}}
        />
      )}
    </main>
  );
}
