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
  const s = await getSettings();
  await closeStaleSessions(Date.now(), s.autoCloseMinutes);
}

export async function bootstrap(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // persistence is best-effort
  }
  applyTheme((await getSettings()).theme);
  await sweep();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sweep();
  });
}
