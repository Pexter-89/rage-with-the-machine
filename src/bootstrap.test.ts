import Dexie from 'dexie';
import { applyTheme, bootstrap, startApp } from './bootstrap';
import { closeOnVersionChange, db, resetDb } from './db/db';
import { addGym } from './db/gymRepo';
import { startSession } from './db/sessionRepo';
import { updateSettings } from './db/settingsRepo';

beforeEach(async () => {
  await resetDb();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('applyTheme sets explicit themes and tolerates a missing matchMedia', () => {
  applyTheme('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  applyTheme('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(typeof matchMedia).toBe('undefined');
  applyTheme('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('bootstrap applies the stored theme without storage.persist', async () => {
  await updateSettings({ theme: 'light' });
  await bootstrap();
  expect(document.documentElement.dataset.theme).toBe('light');
});

/** An open session whose last activity is older than the 30 min default. */
async function staleSession() {
  const g = await addGym('Kamppi');
  return startSession(g.id, Date.now() - 31 * 60_000);
}

test('a failing theme step does not stop the stale-session sweep', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const s = await staleSession();
  vi.spyOn(db.kv, 'get').mockRejectedValueOnce(new Error('kv broken'));
  await expect(bootstrap()).resolves.toBeUndefined();
  expect(await db.sessions.get(s.id)).toBeUndefined(); // stale and empty: deleted by the sweep
  expect(document.documentElement.dataset.theme).toBe('dark'); // fell back to the system theme
  expect(error).toHaveBeenCalled();
});

test('a failing sweep does not stop the theme step', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await updateSettings({ theme: 'light' });
  vi.spyOn(db.sessions, 'filter').mockImplementation(() => {
    throw new Error('sessions broken');
  });
  await expect(bootstrap()).resolves.toBeUndefined();
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(error).toHaveBeenCalled();
});

function becomeVisible() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

test('returning to the app sweeps stale sessions', async () => {
  await bootstrap();
  const s = await staleSession();
  becomeVisible();
  await vi.waitFor(async () => expect(await db.sessions.get(s.id)).toBeUndefined());
});

test('a failing visibilitychange sweep is caught and logged', async () => {
  await bootstrap();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(db.kv, 'get').mockRejectedValue(new Error('kv broken'));
  becomeVisible();
  await vi.waitFor(() => expect(error).toHaveBeenCalled());
});

describe('startApp', () => {
  test('renders after bootstrap resolves', async () => {
    const render = vi.fn();
    await startApp(render, async () => {});
    expect(render).toHaveBeenCalledTimes(1);
  });

  test('renders and logs when bootstrap rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const render = vi.fn();
    await startApp(render, () => Promise.reject(new Error('idb gone')));
    expect(render).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: 'idb gone' }));
  });

  test('renders after the timeout when bootstrap hangs', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const render = vi.fn();
    const started = startApp(render, () => new Promise<void>(() => {}), 3000);
    await vi.advanceTimersByTimeAsync(2999);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await started;
    expect(render).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});

test('closeOnVersionChange closes the connection and reloads so another tab can upgrade', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // Dexie's own versionchange notice
  const reload = vi.fn();
  closeOnVersionChange(db, reload);
  const upgrader = new Dexie('rwtm');
  upgrader.version(2).stores({ kv: 'key' });
  try {
    await upgrader.open();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(db.isOpen()).toBe(false);
  } finally {
    upgrader.close();
    warn.mockRestore();
  }
});
