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
