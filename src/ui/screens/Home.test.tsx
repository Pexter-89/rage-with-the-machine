import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, setGymArchived } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import { getOpenSession, startSession } from '../../db/sessionRepo';
import { updateSettings } from '../../db/settingsRepo';
import Home from './Home';

// skipSweep: Home's on-open sweep does nothing, so the resume query alone must reject timed-out sessions.
const mocks = vi.hoisted(() => ({ skipSweep: false }));
vi.mock('../../db/sessionRepo', async (orig) => {
  const real = await orig<typeof import('../../db/sessionRepo')>();
  return {
    ...real,
    closeStaleSessions: (...a: Parameters<typeof real.closeStaleSessions>) =>
      mocks.skipSweep ? Promise.resolve() : real.closeStaleSessions(...a),
  };
});

beforeEach(async () => {
  mocks.skipSweep = false;
  await resetDb();
  location.hash = '';
});

test('Home lists active gyms in order as start buttons', async () => {
  await addGym('Kamppi');
  await addGym('Otaniemi');
  const old = await addGym('Old');
  await setGymArchived(old.id, true);
  render(<Home />);
  const buttons = await screen.findAllByRole('button', { name: /^▶/ });
  expect(buttons.map((b) => b.textContent)).toEqual(['▶ Kamppi', '▶ Otaniemi']);
});

test('tapping a gym starts a session and navigates to it', async () => {
  await addGym('Kamppi');
  render(<Home />);
  await userEvent.click(await screen.findByRole('button', { name: /Kamppi/ }));
  await vi.waitFor(async () => expect(await getOpenSession()).not.toBeNull());
  expect(location.hash).toMatch(/^#\/session\//);
});

test('tapping the gym that has the open session resumes it instead of starting a second one', async () => {
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now());
  render(<Home />);
  await userEvent.click(await screen.findByRole('button', { name: /^▶ Kamppi/ }));
  await vi.waitFor(() => expect(location.hash).toBe(`#/session/${s.id}`));
  expect(await db.sessions.count()).toBe(1);
  expect((await db.sessions.get(s.id))?.endedAt).toBeNull();
});

test('tapping a different gym finishes the open session and starts a new one', async () => {
  const g = await addGym('Kamppi');
  const other = await addGym('Otaniemi');
  const s = await startSession(g.id, Date.now());
  render(<Home />);
  await userEvent.click(await screen.findByRole('button', { name: /^▶ Otaniemi/ }));
  await vi.waitFor(async () => expect((await getOpenSession())?.gymId).toBe(other.id));
  expect(location.hash).toBe(`#/session/${(await getOpenSession())!.id}`);
  expect(await db.sessions.get(s.id)).toBeUndefined(); // it had no sets
});

test('Home shows resume button for open session', async () => {
  const g = await addGym('Kamppi');
  await addGym('Otaniemi');
  await startSession(g.id, Date.now());
  render(<Home />);
  expect(await screen.findByRole('button', { name: /Resume session at Kamppi/ })).toBeInTheDocument();
});

test('a stale open session is closed at its last activity, not offered for resume', async () => {
  const g = await addGym('Kamppi');
  const old = Date.now() - 3 * 3600_000;
  const s = await startSession(g.id, old);
  await db.sets.add({
    id: 's1',
    sessionId: s.id,
    gymId: g.id,
    catalogId: 'x',
    gymExerciseId: null,
    order: 1,
    weight: 10,
    reps: 5,
    baseWeight: null,
    unit: 'kg',
    completedAt: old,
  });
  await updateSettings({ autoCloseMinutes: 30 });
  render(<Home />);
  await screen.findByRole('button', { name: /^▶ Kamppi/ });
  await vi.waitFor(async () => expect((await db.sessions.get(s.id))?.endedAt).toBe(old));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull());
});

test('a timed-out session is not offered for resume even before the sweep has closed it', async () => {
  mocks.skipSweep = true;
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now() - 31 * 60_000);
  await updateSettings({ autoCloseMinutes: 30 });
  render(<Home />);
  await screen.findByRole('button', { name: /^▶ Kamppi/ });
  expect((await db.sessions.get(s.id))?.endedAt).toBeNull();
  expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
});
