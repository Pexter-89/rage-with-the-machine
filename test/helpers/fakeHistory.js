import { vi } from 'vitest';

/** A browser-like history: go() lands asynchronously and fires popstate, as real browsers do. */
export function fakeHistory() {
  const real = window.history;
  const entries = [{ state: null, url: location.href }];
  let i = 0;
  const show = () => real.replaceState(null, '', entries[i].url);
  const h = {
    get state() {
      return entries[i].state;
    },
    get length() {
      return entries.length;
    },
    pushState(state, _, url) {
      entries.splice(i + 1);
      entries.push({ state, url: new URL(url, location.href).href });
      i++;
      show();
    },
    replaceState(state, _, url) {
      entries[i] = { state, url: new URL(url, location.href).href };
      show();
    },
    go(n) {
      setTimeout(() => {
        const j = Math.max(0, Math.min(entries.length - 1, i + n));
        if (j === i) return;
        i = j;
        show();
        window.dispatchEvent(new PopStateEvent('popstate', { state: entries[i].state }));
      });
    },
    back() {
      h.go(-1);
    },
  };
  vi.stubGlobal('history', h);
  return { urls: () => entries.slice(0, i + 1).map((e) => new URL(e.url).hash), back: () => h.go(-1) };
}
