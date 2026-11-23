import { parseRoute, toHash } from '../../app/js/ui/router.js';

const uuid = '3f2a9c1e-8b7d-4e2f-a1b0-9c8d7e6f5a4b';
const routes = [
  { name: 'home' },
  { name: 'session', sessionId: 'abc' },
  { name: 'session', sessionId: uuid },
  { name: 'pick', sessionId: uuid },
  { name: 'log', sessionId: 'abc', key: 'c:dumbbell-bench-press' },
  { name: 'log', sessionId: uuid, key: 'c:bench-press' },
  { name: 'log', sessionId: uuid, key: 'Käsipainot 💪 / x' },
  { name: 'gyms' },
  { name: 'gym', gymId: 'g1' },
  { name: 'gym', gymId: '--' },
  { name: 'exercise', gymId: 'g1', geId: 'new' },
  { name: 'exercise', gymId: 'g1', geId: 'new', catalogId: 'leg-press' },
  { name: 'exercise', gymId: uuid, geId: uuid, catalogId: 'c:bench-press' },
  { name: 'exercise', gymId: 'g1', geId: 'ge1' },
  { name: 'progress' },
  { name: 'settings' },
  { name: 'programs', gymId: 'g1' },
  { name: 'programs', gymId: 'pick' },
  { name: 'program', gymId: 'g1', programId: 'new' },
  { name: 'program', gymId: 'g 1', programId: 'p/1' },
  { name: 'program', gymId: 'a-', programId: '-b' },
];

const reserved = /^#(settings|sidebar|customize|upgrade|downloads|comment)/;

test('parseRoute/toHash round-trip for every route kind with awkward ids', () => {
  for (const r of routes) expect(parseRoute(toHash(r))).toEqual(r);
});

test('every hash is a plain #name the artifact host passes through, never a reserved one', () => {
  for (const r of routes) {
    const h = toHash(r);
    expect(h).toMatch(/^#[A-Za-z0-9-]+$/);
    expect(h).not.toMatch(reserved);
  }
});

test('sample hashes', () => {
  expect(toHash({ name: 'home' })).toBe('#home');
  expect(toHash({ name: 'settings' })).toBe('#prefs');
  expect(toHash({ name: 'log', sessionId: 'abc', key: 'c:dumbbell-bench-press' })).toBe(
    '#session--abc--log--c-3adumbbell-2dbench-2dpress',
  );
  expect(toHash({ name: 'exercise', gymId: 'g1', geId: 'new', catalogId: 'leg-press' })).toBe(
    '#gym--g1--exercise--new--leg-2dpress',
  );
  expect(toHash({ name: 'gym', gymId: 'ä' })).toBe('#gym---c3-a4');
});

test('the old #/path form still parses to the same route', () => {
  for (const r of routes) {
    if (r.name === 'home') continue;
    const old = legacyHash(r);
    expect(parseRoute(old)).toEqual(r);
  }
  expect(parseRoute('#/')).toEqual({ name: 'home' });
  expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
  expect(parseRoute('#/gym/g1/exercise/new?catalog=leg-press')).toEqual({
    name: 'exercise',
    gymId: 'g1',
    geId: 'new',
    catalogId: 'leg-press',
  });
});

/** The pre-`#name` encoding, as stored links and open tabs still carry it. */
function legacyHash(r) {
  const e = encodeURIComponent;
  switch (r.name) {
    case 'session':
      return `#/session/${e(r.sessionId)}`;
    case 'pick':
      return `#/session/${e(r.sessionId)}/pick`;
    case 'log':
      return `#/session/${e(r.sessionId)}/log/${e(r.key)}`;
    case 'gym':
      return `#/gym/${e(r.gymId)}`;
    case 'exercise':
      return `#/gym/${e(r.gymId)}/exercise/${e(r.geId)}` + (r.catalogId ? `?catalog=${e(r.catalogId)}` : '');
    case 'programs':
      return `#/programs/${e(r.gymId)}`;
    case 'program':
      return `#/programs/${e(r.gymId)}/${e(r.programId)}`;
    default:
      return `#/${r.name}`;
  }
}

test('unknown or malformed hashes go home', () => {
  for (const h of [
    '',
    '#',
    '#home',
    '#/nope',
    '#/session',
    '#/gym/g1/other/x',
    '#/session/%E0%A4%A',
    '#nope',
    '#session',
    '#settings',
    '#session--',
    '#session--a-',
    '#session--a-zz',
    '#session--a-2D',
    '#session--a---b',
    '#session---e0-a4',
    '#gym--g1--other--x',
    '#gym--g1--exercise--e--c--d',
  ]) {
    expect(parseRoute(h)).toEqual({ name: 'home' });
  }
});

describe('history mirrors the menu hierarchy', () => {
  /** A browser-like history: go() lands asynchronously and fires popstate, as real browsers do. */
  function fakeHistory() {
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

  let router;
  let hist;

  beforeEach(async () => {
    vi.resetModules();
    window.history.replaceState(null, '', '#/');
    hist = fakeHistory();
    router = await import('../../app/js/ui/router.js');
  });
  afterEach(() => vi.unstubAllGlobals());

  const settled = () => new Promise((r) => setTimeout(r, 10));

  test('a deep link builds the chain, so back goes up level by level', async () => {
    window.history.replaceState(null, '', '#gym--g1--exercise--e1');
    router.installRouter();
    expect(hist.urls()).toEqual(['#home', '#gyms', '#gym--g1', '#gym--g1--exercise--e1']);
    hist.back();
    await settled();
    expect(location.hash).toBe('#gym--g1');
  });

  test('an old #/path deep link is rewritten to #name entries', async () => {
    window.history.replaceState(null, '', '#/session/s/log/c%3Abench-press');
    router.installRouter();
    expect(hist.urls()).toEqual(['#home', '#session--s', '#session--s--log--c-3abench-2dpress']);
  });

  test('going sideways replaces the branch: back from logging returns to the session, not the picker', async () => {
    router.installRouter();
    router.navigate({ name: 'session', sessionId: 's' });
    router.navigate({ name: 'pick', sessionId: 's' });
    expect(hist.urls()).toEqual(['#home', '#session--s', '#session--s--pick']);
    router.navigate({ name: 'log', sessionId: 's', key: 'k' });
    await settled();
    expect(hist.urls()).toEqual(['#home', '#session--s', '#session--s--log--k']);
    hist.back();
    await settled();
    expect(location.hash).toBe('#session--s');
  });

  test('navigating up pops entries instead of piling them on', async () => {
    router.installRouter();
    router.navigate({ name: 'session', sessionId: 's' });
    router.navigate({ name: 'log', sessionId: 's', key: 'k' });
    router.navigate({ name: 'home' });
    await settled();
    expect(hist.urls()).toEqual(['#home']);
  });

  test('back closes an open sheet and stays on the screen', async () => {
    router.installRouter();
    router.navigate({ name: 'gyms' });
    const close = vi.fn();
    router.openLayer(close);
    expect(hist.urls()).toEqual(['#home', '#gyms', '#gyms']);
    hist.back();
    await settled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#gyms');
    expect(hist.urls()).toEqual(['#home', '#gyms']);
  });

  test('a sheet closed by the app drops its entry; navigating with a sheet open drops it too', async () => {
    router.installRouter();
    router.navigate({ name: 'gyms' });
    const t = router.openLayer(vi.fn());
    router.closeLayer(t);
    await settled();
    expect(hist.urls()).toEqual(['#home', '#gyms']);
    router.openLayer(vi.fn());
    router.navigate({ name: 'gym', gymId: 'g' });
    await settled();
    expect(hist.urls()).toEqual(['#home', '#gyms', '#gym--g']);
  });

  test('parentOf follows the menu levels', () => {
    expect(router.parentOf({ name: 'log', sessionId: 's', key: 'k' })).toEqual({ name: 'session', sessionId: 's' });
    expect(router.parentOf({ name: 'exercise', gymId: 'g', geId: 'new' })).toEqual({ name: 'gym', gymId: 'g' });
    expect(router.parentOf({ name: 'home' })).toBeNull();
    expect(router.parentOf({ name: 'programs', gymId: 'g' })).toEqual({ name: 'home' });
    expect(router.parentOf({ name: 'program', gymId: 'g', programId: 'p' })).toEqual({ name: 'programs', gymId: 'g' });
  });
});
