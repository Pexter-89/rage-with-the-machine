import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { listGyms } from '../../db/gymRepo';
import { closeStaleSessions, getOpenSession, isResumable, startOrResumeSession } from '../../db/sessionRepo';
import { getSettings } from '../../db/settingsRepo';
import { navigate } from '../router';

export default function Home() {
  // Close timed-out sessions first so the resume check below never offers a stale one.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      const settings = await getSettings();
      await closeStaleSessions(Date.now(), settings.autoCloseMinutes);
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const gyms = useLiveQuery(() => listGyms(), []);
  const open = useLiveQuery(async () => {
    const [s, settings] = await Promise.all([getOpenSession(), getSettings()]);
    // Judge staleness here too: this query may still hold its pre-sweep result when `ready` flips.
    if (!s || !isResumable(s, Date.now(), settings.autoCloseMinutes)) return null;
    return { session: s, gym: await db.gyms.get(s.gymId) };
  }, []);

  async function start(gymId: string) {
    const settings = await getSettings();
    // The open session's own gym resumes it (e.g. after iOS killed the app mid-workout); another gym starts afresh.
    const s = await startOrResumeSession(gymId, Date.now(), settings.autoCloseMinutes);
    navigate({ name: 'session', sessionId: s.id });
  }

  return (
    <main className="screen home">
      <h1 className="title">Rage with the machine</h1>
      {ready && gyms && open !== undefined && (
        <>
          {open?.gym && (
            <button className="btn btn-big btn-ok" onClick={() => navigate({ name: 'session', sessionId: open.session.id })}>
              Resume session at {open.gym.name}
            </button>
          )}
          <p className="hint">Start a session</p>
          {gyms.length === 0 && <p className="hint">No gyms yet. Add one under Gyms.</p>}
          {gyms.map((g) => (
            <button key={g.id} className="btn btn-big btn-primary btn-left" onClick={() => start(g.id)}>
              ▶ {g.name}
            </button>
          ))}
        </>
      )}
      <div className="spacer" />
      <nav className="nav-row">
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'gyms' })}>
          Gyms
        </button>
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'progress' })}>
          Progress
        </button>
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'settings' })}>
          Settings
        </button>
      </nav>
    </main>
  );
}
