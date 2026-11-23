import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, setGymArchived } from '../../../app/js/db/gymRepo.js';
import { db, resetDb } from '../../../app/js/db/db.js';
import { getOpenSession, startSession } from '../../../app/js/db/sessionRepo.js';
import { updateSettings } from '../../../app/js/db/settingsRepo.js';
import Home from '../../../app/js/ui/screens/Home.js';
import { html } from '../../../app/js/lib/html.js';
import { toHash } from '../../../app/js/ui/router.js';

// skipSweep: Home's on-open sweep does nothing, so the resume query alone must reject timed-out sessions.
const mocks = vi.hoisted(() => ({ skipSweep: false }));
vi.mock('../../../app/js/db/sessionRepo.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    closeStaleSessions: (...a) => (mocks.skipSweep ? Promise.resolve() : real.closeStaleSessions(...a)),
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
  render(html`<${Home} />`);
  const buttons = await screen.findAllByRole('button', { name: /^▶/ });
  expect(buttons.map((b) => b.textContent)).toEqual(['▶ Kamppi', '▶ Otaniemi']);
});

test('tapping a gym starts a session and navigates to it', async () => {
  await addGym('Kamppi');
  render(html`<${Home} />`);
  await userEvent.click(await screen.findByRole('button', { name: /^▶ Kamppi/ }));
  await vi.waitFor(async () => expect(await getOpenSession()).not.toBeNull());
  expect(location.hash).toBe(toHash({ name: 'session', sessionId: (await getOpenSession()).id }));
});

test('tapping the gym that has the open session resumes it instead of starting a second one', async () => {
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now());
  render(html`<${Home} />`);
  await userEvent.click(await screen.findByRole('button', { name: /^▶ Kamppi/ }));
  await vi.waitFor(() => expect(location.hash).toBe(toHash({ name: 'session', sessionId: s.id })));
  expect(await db.sessions.count()).toBe(1);
  expect((await db.sessions.get(s.id))?.endedAt).toBeNull();
});

test('tapping a different gym finishes the open session and starts a new one', async () => {
  const g = await addGym('Kamppi');
  const other = await addGym('Otaniemi');
  const s = await startSession(g.id, Date.now());
  render(html`<${Home} />`);
  await userEvent.click(await screen.findByRole('button', { name: /^▶ Otaniemi/ }));
  await vi.waitFor(async () => expect((await getOpenSession())?.gymId).toBe(other.id));
  expect(location.hash).toBe(toHash({ name: 'session', sessionId: (await getOpenSession()).id }));
  expect(await db.sessions.get(s.id)).toBeUndefined(); // it had no sets
});

test('Home shows resume button for open session', async () => {
  const g = await addGym('Kamppi');
  await addGym('Otaniemi');
  await startSession(g.id, Date.now());
  render(html`<${Home} />`);
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
  render(html`<${Home} />`);
  await screen.findByRole('button', { name: /^▶ Kamppi/ });
  await vi.waitFor(async () => expect((await db.sessions.get(s.id))?.endedAt).toBe(old));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull());
});

test('a timed-out session is not offered for resume even before the sweep has closed it', async () => {
  mocks.skipSweep = true;
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now() - 31 * 60_000);
  await updateSettings({ autoCloseMinutes: 30 });
  render(html`<${Home} />`);
  await screen.findByRole('button', { name: /^▶ Kamppi/ });
  expect((await db.sessions.get(s.id))?.endedAt).toBeNull();
  expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
});

test('the ✕ on the resume button deletes the open session after confirming', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now());
  render(html`<${Home} />`);
  await user.click(await screen.findByRole('button', { name: 'Delete session' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete session?' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(await db.sessions.get(s.id)).toBeDefined();

  await user.click(screen.getByRole('button', { name: 'Delete session' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(async () => expect(await db.sessions.get(s.id)).toBeUndefined());
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull());
});

test('each gym button is split: the right half opens that gym’s program list', async () => {
  const g = await addGym('Kamppi');
  await addGym('Otaniemi');
  render(html`<${Home} />`);
  const programs = await screen.findByRole('button', { name: 'Programs at Kamppi' });
  expect(programs).toHaveTextContent('Programs');
  expect(screen.getByRole('button', { name: 'Programs at Otaniemi' })).toBeInTheDocument();
  await userEvent.click(programs);
  expect(location.hash).toBe(toHash({ name: 'programs', gymId: g.id }));
  expect(await db.sessions.count()).toBe(0); // the right half starts nothing
});
