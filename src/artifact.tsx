import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrap } from './bootstrap';
import { CloudSync, resolveCloudDb, setActiveCloudSync, type SyncStatus } from './db/cloudSync';
import { RwtmDB, db, setDb } from './db/db';
import App from './ui/App';
import ErrorBoundary from './ui/ErrorBoundary';

/**
 * Startup for the Claude artifact build. The artifact's `db` capability is the source of truth: the app
 * renders only after every collection has loaded into Dexie (or shows an error with a retry button, never
 * an empty app over real cloud data). Without the capability it runs on local IndexedDB as before.
 */

type Phase =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'ready'; localOnly: boolean };

let phase: Phase = { name: 'loading' };
const subs = new Set<() => void>();
function setPhase(p: Phase) {
  phase = p;
  subs.forEach((fn) => fn());
}
const subscribePhase = (fn: () => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

let sync: CloudSync | null = null;
const noStatus = () => () => {};
const NO_STATUS: SyncStatus = { phase: 'idle', error: null, pending: 0, failed: 0, failMessage: null, disconnected: false };

async function indexedDbWorks(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return false;
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      const req = indexedDB.open('rwtm-probe');
      req.onsuccess = () => {
        clearTimeout(timer);
        req.result.close();
        resolve(true);
      };
      req.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

async function bootWithTimeout(ms = 3000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    bootstrap().catch((e: unknown) => console.error('Startup failed', e)),
    new Promise<void>((r) => (timer = setTimeout(r, ms))),
  ]);
  clearTimeout(timer);
}

async function loadCloud(): Promise<void> {
  setPhase({ name: 'loading' });
  try {
    await sync!.start();
  } catch (e) {
    setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });
    return;
  }
  await bootWithTimeout();
  setPhase({ name: 'ready', localOnly: false });
}

async function start(): Promise<void> {
  // A sandboxed frame may refuse IndexedDB: the cloud is the source of truth, so a memory store will do.
  if (!(await indexedDbWorks())) {
    console.warn('IndexedDB is unavailable; using an in-memory store');
    const fake = await import('fake-indexeddb');
    setDb(new RwtmDB({ indexedDB: fake.indexedDB, IDBKeyRange: fake.IDBKeyRange }));
  }
  const cloud = await resolveCloudDb();
  if (!cloud) {
    await bootWithTimeout();
    const framed = typeof (globalThis as { claude?: unknown }).claude === 'object';
    setPhase({ name: 'ready', localOnly: framed });
    return;
  }
  sync = new CloudSync(db, cloud);
  setActiveCloudSync(sync);
  window.addEventListener('beforeunload', (e) => {
    const s = sync?.getStatus();
    if (s && s.pending + s.failed > 0) e.preventDefault();
  });
  await loadCloud();
}

function SyncBanner() {
  const status = useSyncExternalStore(sync ? sync.subscribe : noStatus, sync ? sync.getStatus : () => NO_STATUS);
  if (status.failed > 0) {
    return (
      <div className="sync-banner" role="alert">
        <span>Not saved to cloud{status.failMessage ? ` (${status.failMessage})` : ''}</span>
        <button className="btn btn-ghost" onClick={() => sync?.retry()}>
          Retry
        </button>
      </div>
    );
  }
  if (status.disconnected) {
    return (
      <div className="sync-banner" role="status">
        <span>Cloud connection lost: reload to see the latest data</span>
      </div>
    );
  }
  return null;
}

function ArtifactRoot() {
  const p = useSyncExternalStore(subscribePhase, () => phase);
  if (p.name === 'loading') {
    return (
      <main className="screen boot-screen" aria-busy="true">
        <p className="hint">Loading your training data…</p>
      </main>
    );
  }
  if (p.name === 'error') {
    return (
      <main className="screen boot-screen">
        <h1 className="title">Can't load your data</h1>
        <p className="error" role="alert">
          {p.message}
        </p>
        <button className="btn btn-primary" onClick={retryBoot}>
          Retry
        </button>
      </main>
    );
  }
  return (
    <>
      {p.localOnly && (
        <div className="sync-banner" role="status">
          <span>Cloud storage unavailable: changes stay on this device</span>
        </div>
      )}
      <SyncBanner />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </>
  );
}

function fail(e: unknown) {
  setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });
}

function retryBoot() {
  if (sync) void loadCloud();
  else void start().catch(fail);
}

export function startArtifact(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ArtifactRoot />
    </StrictMode>,
  );
  void start().catch(fail);
}
