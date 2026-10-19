import { parseRoute, toHash, type Route } from './router';

const routes: Route[] = [
  { name: 'home' },
  { name: 'session', sessionId: 'abc' },
  { name: 'pick', sessionId: 'abc' },
  { name: 'log', sessionId: 'abc', key: 'c:dumbbell-bench-press' },
  { name: 'gyms' },
  { name: 'gym', gymId: 'g1' },
  { name: 'exercise', gymId: 'g1', geId: 'new' },
  { name: 'exercise', gymId: 'g1', geId: 'new', catalogId: 'leg-press' },
  { name: 'exercise', gymId: 'g1', geId: 'ge1' },
  { name: 'progress' },
  { name: 'settings' },
];

test('parseRoute/toHash round-trip for every route kind incl. encoded key', () => {
  for (const r of routes) expect(parseRoute(toHash(r))).toEqual(r);
  expect(toHash({ name: 'log', sessionId: 'abc', key: 'c:dumbbell-bench-press' })).toBe(
    '#/session/abc/log/c%3Adumbbell-bench-press',
  );
});

test('unknown or malformed hashes go home', () => {
  for (const h of ['', '#', '#/nope', '#/session', '#/gym/g1/other/x', '#/session/%E0%A4%A']) {
    expect(parseRoute(h)).toEqual({ name: 'home' });
  }
});

describe('history mirrors the menu hierarchy', () => {
  /** A browser-like history: go() lands asynchronously and fires popstate, as real browsers do. */
  function fakeHistory() {
    const real = window.history;
    const entries: { state: unknown; url: string }[] = [{ state: null, url: location.href }];
    let i = 0;
    const show = () => real.replaceState(null, '', entries[i].url);
    const h = {
      get state() {
        return entries[i].state;
      },
      get length() {
        return entries.length;
      },
      pushState(state: unknown, _: string, url: string) {
        entries.splice(i + 1);
        entries.push({ state, url: new URL(url, location.href).href });
        i++;
        show();
      },
      replaceState(state: unknown, _: string, url: string) {
        entries[i] = { state, url: new URL(url, location.href).href };
        show();
      },
      go(n: number) {
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

  let router: typeof import('./router');
  let hist: ReturnType<typeof fakeHistory>;

  beforeEach(async () => {
    vi.resetModules();
    window.history.replaceState(null, '', '#/');
    hist = fakeHistory();
    router = await import('./router');
  });
  afterEach(() => vi.unstubAllGlobals());

  const settled = () => new Promise((r) => setTimeout(r, 10));

  test('a deep link builds the chain, so back goes up level by level', async () => {
    window.history.replaceState(null, '', '#/gym/g1/exercise/e1');
    router.installRouter();
    expect(hist.urls()).toEqual(['#/', '#/gyms', '#/gym/g1', '#/gym/g1/exercise/e1']);
    hist.back();
    await settled();
    expect(location.hash).toBe('#/gym/g1');
  });

  test('going sideways replaces the branch: back from logging returns to the session, not the picker', async () => {
    router.installRouter();
    router.navigate({ name: 'session', sessionId: 's' });
    router.navigate({ name: 'pick', sessionId: 's' });
    expect(hist.urls()).toEqual(['#/', '#/session/s', '#/session/s/pick']);
    router.navigate({ name: 'log', sessionId: 's', key: 'k' });
    await settled();
    expect(hist.urls()).toEqual(['#/', '#/session/s', '#/session/s/log/k']);
    hist.back();
    await settled();
    expect(location.hash).toBe('#/session/s');
  });

  test('navigating up pops entries instead of piling them on', async () => {
    router.installRouter();
    router.navigate({ name: 'session', sessionId: 's' });
    router.navigate({ name: 'log', sessionId: 's', key: 'k' });
    router.navigate({ name: 'home' });
    await settled();
    expect(hist.urls()).toEqual(['#/']);
  });

  test('back closes an open sheet and stays on the screen', async () => {
    router.installRouter();
    router.navigate({ name: 'gyms' });
    const close = vi.fn();
    router.openLayer(close);
    expect(hist.urls()).toEqual(['#/', '#/gyms', '#/gyms']);
    hist.back();
    await settled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#/gyms');
    expect(hist.urls()).toEqual(['#/', '#/gyms']);
  });

  test('a sheet closed by the app drops its entry; navigating with a sheet open drops it too', async () => {
    router.installRouter();
    router.navigate({ name: 'gyms' });
    const t = router.openLayer(vi.fn());
    router.closeLayer(t);
    await settled();
    expect(hist.urls()).toEqual(['#/', '#/gyms']);
    router.openLayer(vi.fn());
    router.navigate({ name: 'gym', gymId: 'g' });
    await settled();
    expect(hist.urls()).toEqual(['#/', '#/gyms', '#/gym/g']);
  });

  test('parentOf follows the menu levels', () => {
    expect(router.parentOf({ name: 'log', sessionId: 's', key: 'k' })).toEqual({ name: 'session', sessionId: 's' });
    expect(router.parentOf({ name: 'exercise', gymId: 'g', geId: 'new' })).toEqual({ name: 'gym', gymId: 'g' });
    expect(router.parentOf({ name: 'home' })).toBeNull();
  });
});
