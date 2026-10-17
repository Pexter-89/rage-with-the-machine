import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, saveGymExercise } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import { startSession } from '../../db/sessionRepo';
import { formatDate } from '../../domain/dates';
import type { Loading } from '../../domain/types';
import Logging from './Logging';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

const STACK: Loading = { type: 'stack', weights: [60, 62, 64, 66] };

async function seed(opts: { catalogId?: string; loading?: Loading } = {}) {
  const g = await addGym('Kamppi');
  const s = await startSession(g.id, Date.now());
  const ge = await saveGymExercise({
    gymId: g.id,
    catalogId: opts.catalogId ?? 'leg-press',
    label: 'Technogym',
    notes: '',
    loading: opts.loading ?? STACK,
    hidden: false,
  });
  return { g, s, ge };
}

async function addOldSets(gymId: string, gymExerciseId: string, rows: [number, number][], catalogId = 'leg-press') {
  const old = await startSession(gymId, new Date(2026, 9, 10, 18).getTime());
  let order = 1;
  for (const [weight, reps] of rows) {
    await db.sets.add({
      id: crypto.randomUUID(),
      sessionId: old.id,
      gymId,
      catalogId,
      gymExerciseId,
      order,
      weight,
      reps,
      baseWeight: null,
      unit: 'kg',
      completedAt: old.startedAt + order,
    });
    order++;
  }
  await db.sessions.update(old.id, { endedAt: old.startedAt + 3_600_000 });
  return old;
}

// Start the current session after the old one so ordering is unambiguous.
async function seedWithHistory(rows: [number, number][]) {
  const g = await addGym('Kamppi');
  const ge = await saveGymExercise({
    gymId: g.id,
    catalogId: 'leg-press',
    label: 'Technogym',
    notes: '',
    loading: STACK,
    hidden: false,
  });
  const old = await addOldSets(g.id, ge.id, rows);
  const s = await startSession(g.id, Date.now());
  return { g, s, ge, old };
}

test('shows last time from same gym: "Last time · 10 Oct 2026 · Kamppi" and summary', async () => {
  const { s, ge, old } = await seedWithHistory([
    [60, 10],
    [62, 8],
  ]);
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  expect(await screen.findByText(`Last time · ${formatDate(old.startedAt)} · Kamppi`)).toBeInTheDocument();
  expect(formatDate(old.startedAt)).toBe('10 Oct 2026');
  expect(screen.getByText('2 sets · 8–10 reps · 60–62 kg')).toBeInTheDocument();
});

test('no last time renders no box', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await screen.findByRole('button', { name: 'Complete set' });
  expect(screen.queryByText(/Last time/)).not.toBeInTheDocument();
});

test('prefills from last time last set', async () => {
  const { s, ge } = await seedWithHistory([
    [60, 10],
    [64, 8],
  ]);
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  expect(await screen.findByRole('button', { name: 'KG 64' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'REPS 8' })).toBeInTheDocument();
});

test('Complete set saves to DB and new row prefilled with that set', async () => {
  const { s, ge } = await seedWithHistory([[62, 10]]);
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  await vi.waitFor(async () => expect((await db.sets.where('sessionId').equals(s.id).toArray()).length).toBe(1));
  const saved = (await db.sets.where('sessionId').equals(s.id).toArray())[0];
  expect([saved.weight, saved.reps]).toEqual([62, 10]);
  expect(await screen.findByRole('button', { name: '1 62 kg × 10' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'KG 62' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'REPS 10' })).toBeInTheDocument();
});

test('editing a completed set via sheet updates DB; delete removes it', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  await userEvent.click(await screen.findByRole('button', { name: '1 60 kg × 10' }));

  const dialog = within(await screen.findByRole('dialog'));
  await userEvent.click(dialog.getByRole('button', { name: 'REPS 10' }));
  const input = dialog.getByRole('textbox');
  await userEvent.clear(input);
  await userEvent.type(input, '12{Enter}');
  await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

  await vi.waitFor(async () => expect((await db.sets.toArray())[0].reps).toBe(12));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(await screen.findByRole('button', { name: '1 60 kg × 12' }));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(async () => expect(await db.sets.count()).toBe(0));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('unilateral exercise labels reps per side', async () => {
  const { s, ge } = await seed({ catalogId: 'cable-glute-kickback' });
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  expect(await screen.findByText('REPS / SIDE')).toBeInTheDocument();
});

test('no last time and no sets → weight = first wheel value, reps 10', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  expect(await screen.findByRole('button', { name: 'KG 60' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'REPS 10' })).toBeInTheDocument();
});

test('stack level unit shows LEVEL label with L suffix', async () => {
  const { s, ge } = await seed({ loading: { type: 'stack', weights: [1, 2, 3], unit: 'level' } });
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  expect(await screen.findByText('LEVEL')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'LEVEL 1' })).toHaveTextContent('1L');
});

test('missing item navigates back to the session; ended session goes home', async () => {
  const { s } = await seed();
  location.hash = `#/session/${s.id}/log/nope`;
  render(<Logging sessionId={s.id} itemKey="nope" />);
  await vi.waitFor(() => expect(location.hash).toBe(`#/session/${s.id}`));
});

test('ended session redirects home', async () => {
  const { s, ge } = await seed();
  await db.sessions.update(s.id, { endedAt: Date.now() });
  location.hash = `#/session/${s.id}/log/${ge.id}`;
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await vi.waitFor(() => expect(location.hash).toBe('#/'));
});

test('Back returns to the session', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: '‹ Back to session' }));
  expect(location.hash).toBe(`#/session/${s.id}`);
});

function scrollTo(scroller: Element, row: number) {
  Object.defineProperty(scroller, 'scrollTop', { get: () => row * 44, set: () => {}, configurable: true });
  fireEvent.scroll(scroller);
}

test('Complete set commits the weight on screen while the wheel is still settling', async () => {
  const { s, ge } = await seed();
  const { container } = render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  await screen.findByRole('button', { name: '1 60 kg × 10' });
  scrollTo(container.querySelectorAll('.wheel-scroll')[0], 2);
  await userEvent.click(screen.getByRole('button', { name: 'Complete set' }));
  await vi.waitFor(async () => expect(await db.sets.count()).toBe(2));
  const weights = (await db.sets.toArray()).sort((a, b) => a.order - b.order).map((x) => x.weight);
  expect(weights).toEqual([60, 64]);
});

test('Save commits the wheel value on screen while settling', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  await userEvent.click(await screen.findByRole('button', { name: '1 60 kg × 10' }));
  const dialog = await screen.findByRole('dialog');
  scrollTo(dialog.querySelectorAll('.wheel-scroll')[0], 3);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await vi.waitFor(async () => expect((await db.sets.toArray())[0].weight).toBe(66));
});

test('a typed off-wheel weight is kept when the screen is reopened', async () => {
  const { s, ge } = await seed();
  const first = render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'KG 60' }));
  const input = screen.getByRole('textbox');
  await userEvent.clear(input);
  await userEvent.type(input, '63{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Complete set' }));
  await screen.findByRole('button', { name: '1 63 kg × 10' });
  first.unmount();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  expect(await screen.findByRole('button', { name: 'KG 63' })).toBeInTheDocument();
});

test('both wheels moved mid-settle: saved, shown, and repeated on the next tap', async () => {
  const { s, ge } = await seed();
  const { container } = render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await screen.findByRole('button', { name: 'Complete set' });
  const [w, r] = container.querySelectorAll('.wheel-scroll');
  scrollTo(w, 2);
  scrollTo(r, 14); // reps 15
  await userEvent.click(screen.getByRole('button', { name: 'Complete set' }));
  expect(await screen.findByRole('button', { name: '1 64 kg × 15' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'KG 64' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'REPS 15' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Complete set' }));
  expect(await screen.findByRole('button', { name: '2 64 kg × 15' })).toBeInTheDocument();
});

test('Complete set commits a typed value that was not confirmed with Enter', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'KG 60' }));
  const input = screen.getByRole('textbox');
  await userEvent.clear(input);
  await userEvent.type(input, '70');
  fireEvent.click(screen.getByRole('button', { name: 'Complete set' }));
  await vi.waitFor(async () => expect((await db.sets.toArray())[0]?.weight).toBe(70));
});
