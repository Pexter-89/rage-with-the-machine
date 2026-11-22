import { closeOnVersionChange } from './db/db.js';
import { closeStaleSessions } from './db/sessionRepo.js';
import { getSettings } from './db/settingsRepo.js';

let unlisten = null;

/** @param {Settings['theme']} theme */
export function applyTheme(theme) {
  unlisten?.();
  unlisten = null;
  const set = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  if (theme !== 'system') {
    set(theme === 'dark');
    return;
  }
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  if (!mq) {
    set(true);
    return;
  }
  set(mq.matches);
  const on = (e) => set(e.matches);
  mq.addEventListener('change', on);
  unlisten = () => mq.removeEventListener('change', on);
}

/** @returns {Promise<void>} */
async function sweep() {
  try {
    const s = await getSettings();
    await closeStaleSessions(Date.now(), s.autoCloseMinutes);
  } catch (e) {
    console.error('Could not close stale sessions', e);
  }
}

let listening = false;

/**
 * Each step is isolated: a failing theme read does not skip the sweep, and neither rejects.
 * @returns {Promise<void>}
 */
export async function bootstrap() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // persistence is best-effort
  }
  closeOnVersionChange();
  try {
    applyTheme((await getSettings()).theme);
  } catch (e) {
    console.error('Could not read the theme', e);
    applyTheme('system');
  }
  await sweep();
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sweep();
    });
  }
}

export const BOOT_TIMEOUT_MS = 3000;

/**
 * Runs `boot`, then `render` exactly once: even when boot rejects, or after `timeoutMs` if it hangs.
 * @param {() => void} render
 * @param {() => Promise<void>} [boot=bootstrap]
 * @returns {Promise<void>}
 */
export async function startApp(render, boot = bootstrap, timeoutMs = BOOT_TIMEOUT_MS) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Startup took over ${timeoutMs} ms; rendering anyway`);
      resolve();
    }, timeoutMs);
  });
  const booted = Promise.resolve()
    .then(boot)
    .catch((e) => console.error('Startup failed', e));
  await Promise.race([booted, timedOut]);
  clearTimeout(timer);
  render();
}
