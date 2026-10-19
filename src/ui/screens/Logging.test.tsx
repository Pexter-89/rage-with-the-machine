import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, saveGymExercise } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import { SessionEndedError, startSession } from '../../db/sessionRepo';
import { formatDate } from '../../domain/dates';
import type { Loading } from '../../domain/types';
import { ITEM_HEIGHT } from '../components/Wheel';
import Logging from './Logging';

// fail: the next repo write (addSet / updateSet / deleteSet) rejects with this error instead of running.
const mocks = vi.hoisted(() => ({ fail: null as null | (() => Error) }));
vi.mock('../../db/sessionRepo', async (orig) => {
  const real = await orig<typeof import('../../db/sessionRepo')>();
  const failing =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    (...a: A) => {
      const make = mocks.fail;
      mocks.fail = null;
      return make ? Promise.reject(make()) : fn(...a);
    };
  return {
    ...real,
    addSet: failing(real.addSet),
    updateSet: failing(real.updateSet),
    deleteSet: failing(real.deleteSet),
  };
});

beforeEach(async () => {
  mocks.fail = null;
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
  Object.defineProperty(scroller, 'scrollTop', { get: () => row * ITEM_HEIGHT, set: () => {}, configurable: true });
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

test('a failed Complete set shows a one-line inline error and saves nothing', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  mocks.fail = () => new Error('QuotaExceededError: disk full\nstack');
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('QuotaExceededError: disk full');
  expect(screen.getByRole('alert')).not.toHaveTextContent('stack');
  expect(await db.sets.count()).toBe(0);
  // The next successful set clears the error.
  await userEvent.click(screen.getByRole('button', { name: 'Complete set' }));
  await screen.findByRole('button', { name: '1 60 kg × 10' });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('Complete set into a session that has just ended navigates home', async () => {
  const { s, ge } = await seed();
  location.hash = `#/session/${s.id}/log/${ge.id}`;
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  mocks.fail = () => new SessionEndedError(s.id);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  await vi.waitFor(() => expect(location.hash).toBe('#/'));
});

test('a failed Save or Delete in the edit sheet shows an inline error and keeps the sheet open', async () => {
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  await userEvent.click(await screen.findByRole('button', { name: '1 60 kg × 10' }));
  const dialog = within(await screen.findByRole('dialog'));
  mocks.fail = () => new Error('write failed');
  await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('write failed');
  mocks.fail = () => new Error('delete failed');
  await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('delete failed');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(await db.sets.count()).toBe(1);
});

test('Save in the edit sheet after the session ended navigates home', async () => {
  const { s, ge } = await seed();
  location.hash = `#/session/${s.id}/log/${ge.id}`;
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Complete set' }));
  await userEvent.click(await screen.findByRole('button', { name: '1 60 kg × 10' }));
  mocks.fail = () => new SessionEndedError(s.id);
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
  await vi.waitFor(() => expect(location.hash).toBe('#/'));
});

test('the ✕ on a done set deletes it after confirming', async () => {
  const user = userEvent.setup();
  const { s, ge } = await seed();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await user.click(await screen.findByRole('button', { name: 'Complete set' }));
  await user.click(await screen.findByRole('button', { name: 'Delete set 1' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete set?' });
  expect(dialog).toHaveTextContent('Set 1: 60 kg × 10');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(async () => expect(await db.sets.count()).toBe(0));
});

test('plate loading: add pairs, take a plate off, and the total is what gets logged', async () => {
  const user = userEvent.setup();
  const { s, ge } = await seed({
    catalogId: 'leg-press',
    loading: { type: 'plates', base: 62, plates: [2.5, 5, 10, 20], sides: 2 },
  });
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  expect(await screen.findByRole('button', { name: 'KG 62' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add 20 kg pair' }));
  await user.click(screen.getByRole('button', { name: 'Add 2.5 kg pair' }));
  await user.click(screen.getByRole('button', { name: 'Add 2.5 kg pair' }));
  expect(screen.getByRole('button', { name: 'KG 112' })).toBeInTheDocument();
  // Two 2.5s stay two 2.5s rather than turning into a 5.
  expect(screen.getAllByRole('button', { name: 'Remove 2.5 kg pair' })).toHaveLength(2);
  await user.click(screen.getAllByRole('button', { name: 'Remove 2.5 kg pair' })[0]);
  expect(screen.getByRole('button', { name: 'KG 107' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Complete set' }));
  await vi.waitFor(async () => expect((await db.sets.toArray())[0]).toMatchObject({ weight: 107, baseWeight: 62 }));
});

test('plate loading: a typed total is shown as plates, with what the plates cannot make', async () => {
  const user = userEvent.setup();
  const { s, ge } = await seed({ loading: { type: 'plates', base: 20, plates: [2.5, 5, 10, 25], sides: 2 } });
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await user.click(await screen.findByRole('button', { name: 'KG 20' }));
  await user.type(screen.getByRole('textbox', { name: 'KG' }), '{Control>}a{/Control}91{Enter}');
  expect(screen.getByRole('button', { name: 'KG 91' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove 25 kg pair' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove 10 kg pair' })).toBeInTheDocument();
  expect(screen.getByText('+0.5')).toBeInTheDocument();
});

test('a rest timer appears once a set is completed and is gone when the screen is left', async () => {
  const { s, ge } = await seed();
  const view = render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await screen.findByRole('button', { name: 'Complete set' });
  expect(screen.queryByRole('timer')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Complete set' }));
  expect(await screen.findByRole('timer', { name: 'Rest timer' })).toHaveTextContent('0:00');
  view.unmount();
  render(<Logging sessionId={s.id} itemKey={ge.id} />);
  await screen.findByRole('button', { name: 'Complete set' });
  expect(screen.queryByRole('timer')).toBeNull();
});
