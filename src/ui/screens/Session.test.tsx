import { render, screen, within } from '@testing-library/react';
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
  const card = await screen.findByRole('button', { name: /^Leg Press/ });
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

test('the ✕ on a logged exercise deletes its sets from the session after confirming', async () => {
  const user = userEvent.setup();
  const { g, s } = await seed();
  const ge = await saveGymExercise({
    gymId: g.id, catalogId: 'leg-press', label: '', notes: '', loading: { type: 'stack', weights: [62, 72] }, hidden: false,
  });
  await addSets(s.id, g.id, ge.id, [[62, 10], [72, 8]]);
  render(<Session sessionId={s.id} />);
  await user.click(await screen.findByRole('button', { name: 'Delete Leg Press sets' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete exercise?' });
  expect(dialog).toHaveTextContent('Leg Press: delete its 2 sets from this session');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(async () => expect(await db.sets.count()).toBe(0));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: /^Leg Press/ })).toBeNull());
});

test('body weight is saved on Enter (decimal comma works), shown again, and cleared when emptied', async () => {
  const user = userEvent.setup();
  const { s } = await seed();
  const view = render(<Session sessionId={s.id} />);
  const field = await screen.findByRole('textbox', { name: 'Body weight, kg' });
  await user.type(field, '82,5{Enter}');
  await vi.waitFor(async () => expect((await db.sessions.get(s.id))?.bodyweight).toBe(82.5));
  view.unmount();
  render(<Session sessionId={s.id} />);
  const again = await screen.findByRole('textbox', { name: 'Body weight, kg' });
  expect(again).toHaveValue('82.5');
  await user.clear(again);
  await user.tab();
  await vi.waitFor(async () => expect((await db.sessions.get(s.id))?.bodyweight).toBeNull());
});

test('body weight: nonsense is dropped, and the last noted weight is the placeholder', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  await db.sessions.add({ id: 'old', gymId: g.id, startedAt: 1, endedAt: 2, lastActivityAt: 1, bodyweight: 81 });
  const s = await startSession(g.id, Date.now());
  render(<Session sessionId={s.id} />);
  const field = await screen.findByRole('textbox', { name: 'Body weight, kg' });
  expect(field).toHaveAttribute('placeholder', '81');
  await user.type(field, 'abc');
  await user.tab();
  await vi.waitFor(() => expect(field).toHaveValue(''));
  expect((await db.sessions.get(s.id))?.bodyweight).toBeUndefined();
});
