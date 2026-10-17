import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { addGym, deleteGym, listGyms, moveGym, renameGym, setGymArchived } from '../../db/gymRepo';
import { navigate } from '../router';

export default function Gyms() {
  const gyms = useLiveQuery(() => listGyms({ includeArchived: true }), []);
  const withSessions = useLiveQuery(async () => new Set((await db.sessions.toArray()).map((s) => s.gymId)), []);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');

  if (!gyms || !withSessions) return <main className="screen" />;

  const active = gyms.filter((g) => !g.archived);

  async function saveNew() {
    const name = newName.trim();
    if (!name) return;
    await addGym(name);
    setNewName('');
  }

  async function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (name) await renameGym(renaming.id, name);
    setRenaming(null);
  }

  return (
    <main className="screen">
      <header className="bar">
        <button className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'home' })}>
          ‹ Home
        </button>
        <h1 className="title">Gyms</h1>
      </header>

      <ul className="list">
        {gyms.map((g) => {
          const i = active.findIndex((a) => a.id === g.id);
          return (
            <li key={g.id} className={'row' + (g.archived ? ' archived' : '')}>
              {renaming?.id === g.id ? (
                <div className="inline-form">
                  <input
                    aria-label="Gym name"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: g.id, name: e.target.value })}
                    autoFocus
                  />
                  <button className="btn btn-primary" onClick={saveRename}>
                    Save name
                  </button>
                </div>
              ) : (
                <>
                  <button className="btn btn-primary btn-left grow" onClick={() => navigate({ name: 'gym', gymId: g.id })}>
                    <span data-testid="gym-name">{g.name}</span>
                    {g.archived && <span className="tag">Archived</span>}
                  </button>
                  <div className="actions">
                    {!g.archived && (
                      <>
                        <button
                          className="btn btn-ghost btn-icon"
                          aria-label={`Move ${g.name} up`}
                          disabled={i <= 0}
                          onClick={() => moveGym(g.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          aria-label={`Move ${g.name} down`}
                          disabled={i < 0 || i >= active.length - 1}
                          onClick={() => moveGym(g.id, 1)}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-ghost btn-small"
                      aria-label={`Rename ${g.name}`}
                      onClick={() => setRenaming({ id: g.id, name: g.name })}
                    >
                      Rename
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      aria-label={`${g.archived ? 'Unarchive' : 'Archive'} ${g.name}`}
                      onClick={() => setGymArchived(g.id, !g.archived)}
                    >
                      {g.archived ? 'Unarchive' : 'Archive'}
                    </button>
                    {!withSessions.has(g.id) && (
                      <button className="btn btn-ghost btn-small" aria-label={`Delete ${g.name}`} onClick={() => deleteGym(g.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <form
        className="inline-form add"
        onSubmit={(e) => {
          e.preventDefault();
          void saveNew();
        }}
      >
        <input aria-label="New gym name" placeholder="Add gym" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </form>
    </main>
  );
}
