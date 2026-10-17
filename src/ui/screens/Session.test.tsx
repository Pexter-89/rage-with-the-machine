import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, saveGymExercise } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import { startSession } from '../../db/sessionRepo';
import { formatTime } from '../../domain/dates';
import Session from './Session';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

async function seed() {
  const g = await addGym('Kamppi');
  const started = Date.now() - 38 * 60_000;
  const s = await startSession(g.id, started);
  return { g, s, started };
}

async function addSets(sessionId: string, gymId: string, gymExerciseId: string | null, rows: [number, number][]) {
  let order = 1;
  for (const [weight, reps] of rows) {
    await db.sets.add({
      id: crypto.randomUUID(),
      sessionId,
      gymId,
      catalogId: 'leg-press',
      gymExerciseId,
      order,
      weight,
      reps,
      baseWeight: null,
      unit: 'kg',
      completedAt: Date.now() + order,
    });
    order++;
  }
}

test('Session shows gym, start time and a Finish session button', async () => {
  const { s, started } = await seed();
  render(<Session sessionId={s.id} />);
  expect(await screen.findByText('Kamppi')).toBeInTheDocument();
  expect(screen.getByText(`Started ${formatTime(started)} · 38 min`)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Finish session' })).toBeInTheDocument();
});

test('elapsed time switches to hours from 60 minutes', async () => {
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now() - 65 * 60_000);
  render(<Session sessionId={s.id} />);
  expect(await screen.findByText(/· 1 h 05 min$/)).toBeInTheDocument();
});

test('Finish session ends session and navigates home', async () => {
  const { g, s } = await seed();
  await addSets(s.id, g.id, null, [[60, 10]]);
  location.hash = `#/session/${s.id}`;
  render(<Session sessionId={s.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Finish session' }));
  await vi.waitFor(async () => expect((await db.sessions.get(s.id))?.endedAt).not.toBeNull());
  expect(location.hash).toBe('#/');
});

test('Session lists logged exercises with summary "2 sets · 8–10 reps · 62–72 kg"', async () => {
  const { g, s } = await seed();
  const ge = await saveGymExercise({
    gymId: g.id,
    catalogId: 'leg-press',
    label: 'Technogym',
    notes: '',
    loading: { type: 'stack', weights: [60, 62, 72] },
    hidden: false,
  });
  await addSets(s.id, g.id, ge.id, [
    [62, 10],
    [72, 8],
  ]);
  render(<Session sessionId={s.id} />);
  const card = await screen.findByRole('button', { name: /Leg Press/ });
  expect(card).toHaveTextContent('Technogym');
  expect(card).toHaveTextContent('2 sets · 8–10 reps · 62–72 kg');
  await userEvent.click(card);
  expect(location.hash).toBe(`#/session/${s.id}/log/${ge.id}`);
});

test('Log exercise navigates to picker', async () => {
  const { s } = await seed();
  render(<Session sessionId={s.id} />);
  await userEvent.click(await screen.findByRole('button', { name: /Log exercise/ }));
  expect(location.hash).toBe(`#/session/${s.id}/pick`);
});

test('an ended or missing session redirects home', async () => {
  const { g, s } = await seed();
  await addSets(s.id, g.id, null, [[60, 10]]);
  await db.sessions.update(s.id, { endedAt: Date.now() });
  location.hash = `#/session/${s.id}`;
  render(<Session sessionId={s.id} />);
  await vi.waitFor(() => expect(location.hash).toBe('#/'));
});
