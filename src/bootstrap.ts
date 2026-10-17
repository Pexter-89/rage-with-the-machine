import { closeOnVersionChange } from './db/db';
import { closeStaleSessions } from './db/sessionRepo';
import { getSettings } from './db/settingsRepo';
import type { Settings } from './domain/types';

let unlisten: (() => void) | null = null;

export function applyTheme(theme: Settings['theme']): void {
  unlisten?.();
  unlisten = null;
  const set = (dark: boolean) => {
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
  const on = (e: MediaQueryListEvent) => set(e.matches);
  mq.addEventListener('change', on);
  unlisten = () => mq.removeEventListener('change', on);
}

async function sweep(): Promise<void> {
  try {
    const s = await getSettings();
    await closeStaleSessions(Date.now(), s.autoCloseMinutes);
  } catch (e) {
    console.error('Could not close stale sessions', e);
  }
}

let listening = false;

/** Each step is isolated: a failing theme read does not skip the sweep, and neither rejects. */
export async function bootstrap(): Promise<void> {
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

/** Runs `boot`, then `render` exactly once: even when boot rejects, or after `timeoutMs` if it hangs. */
export async function startApp(
  render: () => void,
  boot: () => Promise<void> = bootstrap,
  timeoutMs = BOOT_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Startup took over ${timeoutMs} ms; rendering anyway`);
      resolve();
    }, timeoutMs);
  });
  const booted = Promise.resolve()
    .then(boot)
    .catch((e: unknown) => console.error('Startup failed', e));
  await Promise.race([booted, timedOut]);
  clearTimeout(timer);
  render();
}
