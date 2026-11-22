import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import Dexie from 'dexie';
import { BOOT_TIMEOUT_MS, bootstrap, startApp } from './bootstrap.js';
import { CloudSync, resolveCloudDb, setActiveCloudSync } from './db/cloudSync.js';
import { RwtmDB, db, setDb } from './db/db.js';
import App from './ui/App.js';
import ErrorBoundary from './ui/ErrorBoundary.js';
import { installRouter } from './ui/router.js';
import { Fragment, html } from './lib/html.js';

/**
 * Startup of the artifact page. The artifact's `db` capability is the source of truth: the app renders only
 * after every collection has loaded into Dexie (or shows an error with a retry button, never an empty app
 * over real cloud data). Without the capability (opened outside claude.ai) it runs on local IndexedDB.
 */

/** @typedef {{ name: 'loading' } | { name: 'error', message: string } | { name: 'ready', localOnly: boolean }} Phase */

/** @type {Phase} */
let phase = { name: 'loading' };
const subs = new Set();
/** @param {Phase} p */
function setPhase(p) {
  phase = p;
  subs.forEach((fn) => fn());
}
const subscribePhase = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

/** @type {CloudSync | null} */
let sync = null;
const noStatus = () => () => {};
/** @type {import('./db/cloudSync.js').SyncStatus} */
const NO_STATUS = { phase: 'idle', error: null, pending: 0, failed: 0, failMessage: null, disconnected: false };

/** True when IndexedDB opens (a sandboxed frame may refuse it or hang). */
async function indexedDbWorks() {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return false;
    return await new Promise((resolve) => {
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

/** Theme, stale-session sweep etc. (bootstrap.js), but never waits more than `ms` and never rejects. */
function bootWithTimeout(ms = BOOT_TIMEOUT_MS) {
  return startApp(() => {}, bootstrap, ms);
}

async function loadCloud() {
  setPhase({ name: 'loading' });
  try {
    await sync.start();
  } catch (e) {
    setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });
    return;
  }
  await bootWithTimeout();
  setPhase({ name: 'ready', localOnly: false });
}

async function start() {
  // A sandboxed frame may refuse IndexedDB: the cloud is the source of truth, so a memory store will do.
  // fake-indexeddb is only downloaded in that case.
  if (!(await indexedDbWorks())) {
    console.warn('IndexedDB is unavailable; using an in-memory store');
    const fake = await import('fake-indexeddb');
    // liveQuery (useLiveQuery) reads Dexie.dependencies rather than the db's own options: without this it never answers.
    Dexie.dependencies.indexedDB = fake.indexedDB;
    Dexie.dependencies.IDBKeyRange = fake.IDBKeyRange;
    setDb(new RwtmDB({ indexedDB: fake.indexedDB, IDBKeyRange: fake.IDBKeyRange }));
  }
  const cloud = await resolveCloudDb();
  if (!cloud) {
    await bootWithTimeout();
    // Inside claude.ai (window.claude exists) but without the db capability: say that nothing is saved to the cloud.
    const framed = typeof globalThis.claude === 'object';
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

/** Shown while writes to the cloud failed (with Retry) or the live connection dropped. */
function SyncBanner() {
  const status = useSyncExternalStore(sync ? sync.subscribe : noStatus, sync ? sync.getStatus : () => NO_STATUS);
  if (status.failed > 0) {
    return html`
      <div className="sync-banner" role="alert">
        <span>Not saved to cloud${status.failMessage ? ` (${status.failMessage})` : ''}</span>
        <button className="btn btn-ghost" onClick=${() => sync?.retry()}>Retry</button>
      </div>
    `;
  }
  if (status.disconnected) {
    return html`
      <div className="sync-banner" role="status">
        <span>Cloud connection lost: reload to see the latest data</span>
      </div>
    `;
  }
  return null;
}

/** Loading screen, then the error screen or the app. */
function ArtifactRoot() {
  const p = useSyncExternalStore(subscribePhase, () => phase);
  if (p.name === 'loading') {
    return html`
      <main className="screen boot-screen" aria-busy="true">
        <p className="hint">Loading your training data…</p>
      </main>
    `;
  }
  if (p.name === 'error') {
    return html`
      <main className="screen boot-screen">
        <h1 className="title">Can't load your data</h1>
        <p className="error" role="alert">${p.message}</p>
        <button className="btn btn-primary" onClick=${retryBoot}>Retry</button>
      </main>
    `;
  }
  return html`
    <${Fragment}>
      ${p.localOnly &&
      html`
        <div className="sync-banner" role="status">
          <span>Cloud storage unavailable: changes stay on this device</span>
        </div>
      `}
      <${SyncBanner} />
      <${ErrorBoundary}>
        <${App} />
      </${ErrorBoundary}>
    </${Fragment}>
  `;
}

function fail(e) {
  setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });
}

function retryBoot() {
  if (sync) void loadCloud();
  else void start().catch(fail);
}

installRouter();
createRoot(document.getElementById('root')).render(html`
  <${StrictMode}>
    <${ArtifactRoot} />
  </${StrictMode}>
`);
void start().catch(fail);
