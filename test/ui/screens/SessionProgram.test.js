import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, resetDb } from '../../../app/js/db/db.js';
import { addGym, saveGymExercise } from '../../../app/js/db/gymRepo.js';
import { addProgram, getProgram, listPrograms, startProgramSession } from '../../../app/js/db/programRepo.js';
import { addSet } from '../../../app/js/db/sessionRepo.js';
import { formatDate } from '../../../app/js/domain/dates.js';
import Session from '../../../app/js/ui/screens/Session.js';
import { html } from '../../../app/js/lib/html.js';
import { toHash } from '../../../app/js/ui/router.js';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

const STACK = { type: 'stack', weights: [10, 20, 30] };
const machine = (gymId, catalogId, label) =>
  saveGymExercise({ gymId, catalogId, label, notes: '', loading: STACK, hidden: false });
const ITEMS = [
  { catalogId: 'leg-press', sets: 2, reps: 10 },
  { catalogId: 'chest-press', sets: 3, reps: 8 },
  { catalogId: 'pull-up', sets: 3, reps: 6 },
];

async function seed(items = ITEMS) {
  const g = await addGym('Kamppi');
  const lp = await machine(g.id, 'leg-press', 'Technogym');
  const p = await addProgram({ name: 'Full body', items }, 1);
  const s = await startProgramSession(g.id, p.id, Date.now(), 90);
  return { g, lp, p, s };
}

/** @param {string} sessionId @param {{ catalogId: string, gymExerciseId: string | null }} item */
const log = (sessionId, catalogId, gymExerciseId = null) =>
  addSet(sessionId, { catalogId, gymExerciseId, loading: STACK }, 20, 10, Date.now());

const plan = () => within(screen.getByRole('list', { name: 'Plan' }));

test('the plan is a to-do list in plan order: target, progress, ticked when the target is reached', async () => {
  const { s, lp } = await seed();
  render(html`<${Session} sessionId=${s.id} />`);
  expect(await screen.findByText('Full body')).toBeInTheDocument();
  const cards = plan().getAllByRole('listitem');
  expect(cards.map((c) => within(c).getAllByRole('button')[0].getAttribute('aria-label'))).toEqual([
    'Leg Press, 0 of 2 sets',
    'Chest Press, 0 of 3 sets',
    'Pull-Up, 0 of 3 sets',
  ]);
  expect(cards[0]).toHaveTextContent('Technogym');
  expect(cards[0]).toHaveTextContent('2 × 10 · 0/2');

  // Any order, skipping freely.
  await log(s.id, 'pull-up');
  await log(s.id, 'leg-press', lp.id);
  await log(s.id, 'leg-press', lp.id);
  const done = await screen.findByRole('button', { name: 'Leg Press, 2 of 2 sets, done' });
  expect(done.closest('li')).toHaveClass('done');
  expect(done).toHaveTextContent('✓');
  expect(screen.getByRole('button', { name: 'Pull-Up, 1 of 3 sets' }).closest('li')).not.toHaveClass('done');
  expect(screen.queryByText('Extra')).toBeNull();
});

test('extra exercises appear below the plan; a planned card opens logging on this gym’s machine', async () => {
  const user = userEvent.setup();
  const { s, lp } = await seed();
  await log(s.id, 'dumbbell-curl');
  render(html`<${Session} sessionId=${s.id} />`);
  expect(await screen.findByText('Extra')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Dumbbell Curl sets' })).toBeInTheDocument();
  expect(plan().queryByText('Dumbbell Curl')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Leg Press, 0 of 2 sets' }));
  expect(location.hash).toBe(toHash({ name: 'log', sessionId: s.id, key: lp.id }));
  await user.click(screen.getByRole('button', { name: 'Pull-Up, 0 of 3 sets' }));
  expect(location.hash).toBe(toHash({ name: 'log', sessionId: s.id, key: 'c:pull-up' }));
});

test('an exercise the gym lacks says "Not at this gym"; Swap replaces it with one of the same category here', async () => {
  const user = userEvent.setup();
  const { g, p, s } = await seed();
  await machine(g.id, 'pec-deck', 'Pec deck');
  render(html`<${Session} sessionId=${s.id} />`);
  const card = (await screen.findByRole('button', { name: 'Chest Press, 0 of 3 sets' })).closest('li');
  expect(card).toHaveTextContent('Not at this gym · 3 × 8');
  await user.click(within(card).getByRole('button', { name: 'Swap Chest Press' }));
  const sheet = await screen.findByRole('dialog', { name: 'Swap Chest Press' });
  const options = [...sheet.querySelectorAll('.swap-option > span')].map((x) => x.textContent);
  expect(options[0]).toBe('Pec Deck'); // this gym's machine first
  expect(options).toContain('Push-Up');
  expect(options).not.toContain('Chest Press');
  expect(options).not.toContain('Cable Crossover'); // a machine this gym does not have
  await user.click(within(sheet).getByRole('button', { name: 'Push-Up' }));
  expect(await screen.findByRole('button', { name: 'Push-Up, 0 of 3 sets' })).toBeInTheDocument();
  expect((await db.sessions.get(s.id))?.plan?.[1]).toEqual({ catalogId: 'push-up', sets: 3, reps: 8 });
  expect((await getProgram(p.id))?.items[1].catalogId).toBe('chest-press');
  expect(screen.queryByText(/Not at this gym/)).toBeNull();
});

test('tapping a missing exercise opens Swap too', async () => {
  const user = userEvent.setup();
  const { s } = await seed();
  render(html`<${Session} sessionId=${s.id} />`);
  await user.click(await screen.findByRole('button', { name: 'Chest Press, 0 of 3 sets' }));
  expect(await screen.findByRole('dialog', { name: 'Swap Chest Press' })).toBeInTheDocument();
});

test('several machines for an exercise: asks once, then the one last used here is picked', async () => {
  const user = userEvent.setup();
  const { g, s } = await seed([{ catalogId: 'lat-pulldown', sets: 3, reps: 12 }]);
  await machine(g.id, 'lat-pulldown', 'Cable tower');
  const plate = await machine(g.id, 'lat-pulldown', 'Plate-loaded');
  const view = render(html`<${Session} sessionId=${s.id} />`);
  await user.click(await screen.findByRole('button', { name: 'Lat Pulldown, 0 of 3 sets' }));
  const sheet = await screen.findByRole('dialog', { name: 'Which Lat Pulldown?' });
  expect(within(sheet).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Cable tower', 'Plate-loaded']);
  await user.click(within(sheet).getByRole('button', { name: 'Plate-loaded' }));
  expect(location.hash).toBe(toHash({ name: 'log', sessionId: s.id, key: plate.id }));
  view.unmount();

  await log(s.id, 'lat-pulldown', plate.id);
  render(html`<${Session} sessionId=${s.id} />`);
  const card = await screen.findByRole('button', { name: 'Lat Pulldown, 1 of 3 sets' });
  expect(card).toHaveTextContent('Plate-loaded');
  await user.click(card);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(location.hash).toBe(toHash({ name: 'log', sessionId: s.id, key: plate.id }));
});

test('Save as program on an ongoing session: shown once something is logged, named gym + date by default', async () => {
  const user = userEvent.setup();
  const { s, lp } = await seed();
  render(html`<${Session} sessionId=${s.id} />`);
  await screen.findByText('Full body');
  expect(screen.queryByRole('button', { name: 'Save as program' })).toBeNull();
  await log(s.id, 'leg-press', lp.id);
  await log(s.id, 'dumbbell-curl');
  await user.click(await screen.findByRole('button', { name: 'Save as program' }));
  const sheet = await screen.findByRole('dialog', { name: 'Save as program' });
  const name = within(sheet).getByLabelText('Program name');
  expect(name).toHaveValue(`Kamppi ${formatDate(s.startedAt)}`);
  await user.clear(name);
  await user.type(name, 'Tuesday');
  await user.click(within(sheet).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved as program “Tuesday”')).toBeInTheDocument();
  const saved = (await listPrograms()).find((x) => x.name === 'Tuesday');
  expect(saved?.items).toEqual([
    { catalogId: 'leg-press', sets: 1, reps: 10 },
    { catalogId: 'dumbbell-curl', sets: 1, reps: 10 },
  ]);
});

test('a session without a plan shows no plan list', async () => {
  const g = await addGym('Kamppi');
  const s = await db.sessions.add({ id: 'plain', gymId: g.id, startedAt: Date.now(), endedAt: null, lastActivityAt: Date.now() });
  render(html`<${Session} sessionId=${s} />`);
  await screen.findByText('Kamppi');
  expect(screen.queryByRole('list', { name: 'Plan' })).toBeNull();
});

test('sets logged on a second machine of a planned exercise stay reachable as an extra card', async () => {
  const { g, s } = await seed([{ catalogId: 'lat-pulldown', sets: 3, reps: 12 }]);
  const a = await machine(g.id, 'lat-pulldown', 'Cable tower');
  const b = await machine(g.id, 'lat-pulldown', 'Plate-loaded');
  await log(s.id, 'lat-pulldown', b.id);
  await new Promise((r) => setTimeout(r, 5));
  await log(s.id, 'lat-pulldown', a.id); // last used: the plan card resolves to Cable tower
  render(html`<${Session} sessionId=${s.id} />`);
  expect(await screen.findByText('Extra')).toBeInTheDocument();
  const del = screen.getAllByRole('button', { name: /^Delete .* sets$/ });
  expect(del).toHaveLength(1);
  expect(screen.getByText('Plate-loaded')).toBeInTheDocument();
});
