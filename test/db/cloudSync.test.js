import { afterEach, beforeEach, expect, test } from 'vitest';
import { FakeCloudDb } from '../helpers/fakeCloudDb.js';
import { exportBackup, restoreBackup } from '../../app/js/db/backup.js';
import { getCatalog } from '../../app/js/db/catalogRepo.js';
import {
  CloudLoadError,
  CloudSync,
  backupDocCount,
  decodeDocId,
  encodeDocId,
  resolveCloudDb,
} from '../../app/js/db/cloudSync.js';
import { RwtmDB, db, resetDb } from '../../app/js/db/db.js';
import { addDemoData, removeDemoData } from '../../app/js/db/demo.js';
import { addGym, availableExercises, renameGym, deleteGym } from '../../app/js/db/gymRepo.js';
import { addSet, clearHistory, deleteSession, startSession, updateSet } from '../../app/js/db/sessionRepo.js';
import { getSettings, updateSettings } from '../../app/js/db/settingsRepo.js';

const T0 = 1_700_000_000_000;

class MemStorage {
  m = new Map();
  getItem(k) {
    return this.m.get(k) ?? null;
  }
  setItem(k, v) {
    this.m.set(k, v);
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

let cloud;
let sync = null;
let storage;

function connect(opts = {}) {
  sync = new CloudSync(db, cloud, { storage, debounceMs: 5, retryBaseMs: 10, ...opts });
  return sync;
}

beforeEach(async () => {
  await resetDb();
  cloud = new FakeCloudDb();
  storage = new MemStorage();
});

afterEach(() => {
  sync?.stop();
  sync = null;
});

test('doc ids: safe keys pass through, others round-trip', () => {
  expect(encodeDocId('9b2c-uuid_x.y')).toBe('9b2c-uuid_x.y');
  for (const k of ['a/b', 'é ü', '~', '', '.', '..', 'x'.repeat(10), 'a~41']) {
    expect(encodeDocId(k)).toMatch(/^[A-Za-z0-9_\-.~:@+]+$/);
    expect(decodeDocId(encodeDocId(k))).toBe(k);
  }
  expect(encodeDocId('.')).not.toBe('.');
  expect(encodeDocId('y'.repeat(500)).length).toBeLessThanOrEqual(200);
});

test('start replaces local data with the cloud', async () => {
  await addGym('Local only');
  cloud.remoteSet('gyms', 'g1', { id: 'g1', name: 'Cloud gym', order: 0, archived: false });
  cloud.remoteSet('kv', 'settings', {
    key: 'settings',
    value: { theme: 'light', autoCloseMinutes: 45, lastBackupAt: null },
  });
  await connect().start();
  expect((await db.gyms.toArray()).map((g) => g.name)).toEqual(['Cloud gym']);
  expect((await getSettings()).theme).toBe('light');
  expect(sync.getStatus().phase).toBe('ready');
  // hydration itself never writes back
  await sync.whenIdle();
  expect(cloud.writes).toEqual([]);
});

test('start rejects on timeout and leaves local data alone; retry then succeeds', async () => {
  await addGym('Local');
  cloud.silent = true;
  const s = connect({ timeoutMs: 30 });
  await expect(s.start()).rejects.toBeInstanceOf(CloudLoadError);
  expect(s.getStatus().phase).toBe('error');
  expect(await db.gyms.count()).toBe(1);
  cloud.silent = false;
  sync.stop();
  await connect().start();
  expect(await db.gyms.count()).toBe(0);
});

test('a listener error during loading rejects start', async () => {
  const s = connect({ timeoutMs: 1000 });
  cloud.silent = true;
  const p = s.start();
  cloud.terminate('sets', 'revoked');
  await expect(p).rejects.toThrow(/No access/);
});

test('local add, update and delete are written through', async () => {
  await connect().start();
  const gym = await addGym('Downtown');
  await sync.whenIdle();
  expect(cloud.get('gyms', gym.id)).toEqual({ id: gym.id, name: 'Downtown', order: 0, archived: false });

  await renameGym(gym.id, 'Uptown');
  await sync.whenIdle();
  expect(cloud.get('gyms', gym.id)?.name).toBe('Uptown');

  const catalog = await getCatalog();
  const item = (await availableExercises(gym.id, catalog))[0];
  const session = await startSession(gym.id, T0);
  const set = await addSet(session.id, item, 40, 10, T0 + 1000);
  await sync.whenIdle();
  expect(cloud.get('sets', set.id)).toMatchObject({ id: set.id, sessionId: session.id, weight: 40, reps: 10 });
  expect(cloud.get('sessions', session.id)).toMatchObject({ lastActivityAt: T0 + 1000, endedAt: null });

  await deleteSession(session.id);
  await sync.whenIdle();
  expect(cloud.get('sets', set.id)).toBeUndefined();
  expect(cloud.get('sessions', session.id)).toBeUndefined();

  await deleteGym(gym.id);
  await sync.whenIdle();
  expect(cloud.get('gyms', gym.id)).toBeUndefined();
});

test('rapid edits to one row coalesce into one write', async () => {
  await connect().start();
  const gym = await addGym('A');
  await sync.whenIdle();
  const before = cloud.writes.length;
  for (const n of ['B', 'C', 'D', 'E']) await renameGym(gym.id, n);
  await sync.whenIdle();
  expect(cloud.writes.length - before).toBe(1);
  expect(cloud.get('gyms', gym.id)?.name).toBe('E');
});

test('remote changes reach Dexie without being written back', async () => {
  await connect().start();
  cloud.remoteSet('gyms', 'g9', { id: 'g9', name: 'From Claude', order: 3, archived: false });
  await sync.settled();
  expect(await db.gyms.get('g9')).toEqual({ id: 'g9', name: 'From Claude', order: 3, archived: false });
  // the middleware ignored the remote transaction: nothing was even queued
  expect(sync.getStatus().pending).toBe(0);

  cloud.remoteSet('gyms', 'g9', { id: 'g9', name: 'Renamed by Claude', order: 3, archived: false });
  await sync.settled();
  expect((await db.gyms.get('g9'))?.name).toBe('Renamed by Claude');

  cloud.remoteDelete('gyms', 'g9');
  await sync.settled();
  expect(await db.gyms.get('g9')).toBeUndefined();

  await new Promise((r) => setTimeout(r, 20));
  await sync.whenIdle();
  expect(cloud.writes).toEqual([]);
  expect(sync.getStatus().pending).toBe(0);
});

test('a remote doc without its key field gets the key from the doc id', async () => {
  await connect().start();
  cloud.remoteSet('kv', 'note', { value: 3 });
  await sync.settled();
  expect(await db.kv.get('note')).toEqual({ key: 'note', value: 3 });
});

test('our own writes echo back without a second write', async () => {
  await connect().start();
  await updateSettings({ autoCloseMinutes: 50 });
  await sync.whenIdle();
  await sync.settled();
  await new Promise((r) => setTimeout(r, 20));
  await sync.whenIdle();
  expect(cloud.writes.filter((w) => w.path === 'kv/settings')).toHaveLength(1);
});

test('backup import, clear history and demo data sync in bulk', async () => {
  await connect().start();
  const n = await addDemoData(T0);
  await sync.whenIdle();
  expect(cloud.store.get('sessions').size).toBe(n);
  const setCount = await db.sets.count();
  expect(cloud.store.get('sets').size).toBe(setCount);

  const backup = await exportBackup(T0);
  expect(backupDocCount(backup.data)).toBe(2 + 6 + n + setCount + backup.data.customCatalog.length + 1);

  await clearHistory();
  await sync.whenIdle();
  expect(cloud.store.get('sets').size).toBe(0);
  expect(cloud.store.get('sessions').size).toBe(0);
  expect(cloud.store.get('gyms').size).toBe(2);

  await restoreBackup(backup);
  await sync.whenIdle();
  expect(cloud.store.get('sets').size).toBe(setCount);
  expect(cloud.store.get('sessions').size).toBe(n);

  await removeDemoData();
  await sync.whenIdle();
  expect(cloud.store.get('sets').size).toBe(0);
  expect(cloud.store.get('gyms').size).toBe(0);
});

test('failed writes stay queued, are shown, and retry', async () => {
  const s = connect();
  await s.start();
  cloud.failNext = ['quota_exceeded'];
  const gym = await addGym('Full');
  await s.whenIdle();
  expect(s.getStatus()).toMatchObject({ failed: 1, failMessage: 'Cloud storage is full' });
  expect(cloud.get('gyms', gym.id)).toBeUndefined();
  // the unsaved row is persisted for the next visit
  expect(storage.getItem('rwtm-cloud-pending-v1')).toContain(gym.id);

  s.retry();
  await s.whenIdle();
  expect(cloud.get('gyms', gym.id)?.name).toBe('Full');
  expect(s.getStatus()).toMatchObject({ failed: 0, failMessage: null });
  expect(storage.getItem('rwtm-cloud-pending-v1')).toBeNull();
});

test('transient failures retry on their own', async () => {
  const s = connect();
  await s.start();
  cloud.failNext = ['unavailable', 'unavailable'];
  const gym = await addGym('Flaky');
  await vi.waitFor(() => expect(cloud.get('gyms', gym.id)).toBeDefined(), { timeout: 2000 });
  await vi.waitFor(() => expect(s.getStatus().failed).toBe(0));
});

test('a remote change to a row with an unsaved local edit does not clobber it', async () => {
  const s = connect();
  await s.start();
  cloud.failNext = ['quota_exceeded'];
  const gym = await addGym('Mine');
  await s.whenIdle();
  cloud.remoteSet('gyms', gym.id, { ...gym, name: 'Theirs' });
  await s.settled();
  expect((await db.gyms.get(gym.id))?.name).toBe('Mine');
});

test('unsaved writes from an earlier visit are re-applied after loading', async () => {
  storage.setItem(
    'rwtm-cloud-pending-v1',
    JSON.stringify([{ table: 'gyms', pk: 'gx', row: { id: 'gx', name: 'Offline gym', order: 0, archived: false } }]),
  );
  cloud.remoteSet('gyms', 'g1', { id: 'g1', name: 'Cloud', order: 0, archived: false });
  await connect().start();
  await sync.whenIdle();
  expect((await db.gyms.toArray()).map((g) => g.name).sort()).toEqual(['Cloud', 'Offline gym']);
  expect(cloud.get('gyms', 'gx')?.name).toBe('Offline gym');
  expect(storage.getItem('rwtm-cloud-pending-v1')).toBeNull();
});

test('a reloaded page reads back what an earlier page wrote', async () => {
  await connect().start();
  const gym = await addGym('Persisted');
  const item = (await availableExercises(gym.id, await getCatalog()))[0];
  const session = await startSession(gym.id, T0);
  const set = await addSet(session.id, item, 50, 8, T0 + 1);
  await updateSet(set.id, { reps: 9 }, T0 + 2);
  await sync.whenIdle();
  sync.stop();
  sync = null;

  // a fresh device: empty local store, same cloud
  await resetDb();
  await connect().start();
  expect((await db.sets.get(set.id))?.reps).toBe(9);
  expect((await db.gyms.get(gym.id))?.name).toBe('Persisted');
});

test('without the capability the app stays local-only', async () => {
  expect(await resolveCloudDb(50)).toBeNull();
  globalThis.claude = { use: async () => null };
  try {
    expect(await resolveCloudDb(50)).toBeNull();
  } finally {
    delete globalThis.claude;
  }
  // local writes still work and nothing is queued anywhere
  const gym = await addGym('Offline');
  expect((await db.gyms.get(gym.id))?.name).toBe('Offline');
});

test('middleware can be installed on an already-open database', async () => {
  const other = new RwtmDB();
  await other.open();
  const s = new CloudSync(other, cloud, { storage, debounceMs: 5 });
  await s.start();
  await other.gyms.put({ id: 'z', name: 'Z', order: 0, archived: false });
  await s.whenIdle();
  expect(cloud.get('gyms', 'z')?.name).toBe('Z');
  s.stop();
  other.close();
});
