import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, setGymArchived } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import { getOpenSession, startSession } from '../../db/sessionRepo';
import { updateSettings } from '../../db/settingsRepo';
import Home from './Home';

beforeEach(async () => {
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
  expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
  expect((await db.sessions.get(s.id))?.endedAt).toBe(old);
});
