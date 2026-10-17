import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, saveGymExercise } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import { startSession } from '../../db/sessionRepo';
import ExerciseEdit from './ExerciseEdit';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

afterEach(() => vi.restoreAllMocks());

test('ExerciseEdit: create stack machine from "5, 10, 15 20"', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  render(<ExerciseEdit gymId={g.id} geId="new" />);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'lat-pulldown');
  await user.type(screen.getByLabelText('Label'), 'Gym80');
  await user.type(screen.getByLabelText('Stack weights'), '5, 10, 15 20');
  await user.type(screen.getByLabelText('Notes'), 'seat 3');
  await user.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(async () => expect(await db.gymExercises.count()).toBe(1));
  const ge = (await db.gymExercises.toArray())[0];
  expect(ge).toMatchObject({
    gymId: g.id,
    catalogId: 'lat-pulldown',
    label: 'Gym80',
    notes: 'seat 3',
    hidden: false,
    loading: { type: 'stack', weights: [5, 10, 15, 20], unit: 'kg' },
  });
  expect(location.hash).toBe(`#/gym/${g.id}`);
});

test('stack weights are sorted on save and invalid input is rejected inline', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  render(<ExerciseEdit gymId={g.id} geId="new" />);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'leg-press');

  await user.type(screen.getByLabelText('Stack weights'), '20 10 10');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate');
  await user.clear(screen.getByLabelText('Stack weights'));
  await user.type(screen.getByLabelText('Stack weights'), '20 x');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('positive');
  await user.clear(screen.getByLabelText('Stack weights'));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('at least one');
  expect(await db.gymExercises.count()).toBe(0);

  await user.type(screen.getByLabelText('Stack weights'), '30 20 10');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await vi.waitFor(async () => expect(await db.gymExercises.count()).toBe(1));
  expect((await db.gymExercises.toArray())[0].loading).toMatchObject({ weights: [10, 20, 30] });
});

test('plate step and base are validated', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  render(<ExerciseEdit gymId={g.id} geId="new" />);
  await user.selectOptions(await screen.findByLabelText('Exercise'), 'leg-press');
  await user.selectOptions(screen.getByLabelText('Loading type'), 'plate');
  await user.type(screen.getByLabelText('Sled weight (kg)'), '62');
  await user.type(screen.getByLabelText('Plate step (kg)'), '0.1');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('0.25');
  expect(await db.gymExercises.count()).toBe(0);
});

async function plateWithHistory() {
  const g = await addGym('K');
  const ge = await saveGymExercise({
    gymId: g.id,
    catalogId: 'leg-press',
    label: '',
    notes: '',
    loading: { type: 'plate', base: 60, step: 2.5 },
    hidden: false,
  });
  const s = await startSession(g.id, 1000);
  await db.sets.bulkAdd([
    { id: 'a', sessionId: s.id, gymId: g.id, catalogId: 'leg-press', gymExerciseId: ge.id, order: 0, weight: 100, reps: 5, baseWeight: 60, unit: 'kg', completedAt: 1 },
    { id: 'b', sessionId: s.id, gymId: g.id, catalogId: 'leg-press', gymExerciseId: ge.id, order: 1, weight: 110, reps: 5, baseWeight: 60, unit: 'kg', completedAt: 2 },
  ]);
  return { g, ge };
}

test('ExerciseEdit: changing plate base with history asks to recompute and shifts weights', async () => {
  const user = userEvent.setup();
  const { g, ge } = await plateWithHistory();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<ExerciseEdit gymId={g.id} geId={ge.id} />);
  const base = await screen.findByLabelText('Sled weight (kg)');
  await user.clear(base);
  await user.type(base, '62');
  await user.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(async () => expect((await db.gymExercises.get(ge.id))!.loading).toMatchObject({ base: 62 }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith('Recompute 2 past sets for the new sled weight?');
  const sets = (await db.sets.toArray()).sort((a, b) => a.order - b.order);
  expect(sets.map((s) => [s.weight, s.baseWeight])).toEqual([[102, 62], [112, 62]]);
});

test('declining the recompute still saves the new base and leaves history alone', async () => {
  const user = userEvent.setup();
  const { g, ge } = await plateWithHistory();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ExerciseEdit gymId={g.id} geId={ge.id} />);
  const base = await screen.findByLabelText('Sled weight (kg)');
  await user.clear(base);
  await user.type(base, '62');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await vi.waitFor(async () => expect((await db.gymExercises.get(ge.id))!.loading).toMatchObject({ base: 62 }));
  expect((await db.sets.toArray()).map((s) => s.weight).sort()).toEqual([100, 110]);
});

test('no confirm when the base has no history', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  const ge = await saveGymExercise({
    gymId: g.id, catalogId: 'leg-press', label: '', notes: '', loading: { type: 'plate', base: 60, step: 2.5 }, hidden: false,
  });
  const confirm = vi.spyOn(window, 'confirm');
  render(<ExerciseEdit gymId={g.id} geId={ge.id} />);
  const base = await screen.findByLabelText('Sled weight (kg)');
  await user.clear(base);
  await user.type(base, '65');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await vi.waitFor(async () => expect((await db.gymExercises.get(ge.id))!.loading).toMatchObject({ base: 65 }));
  expect(confirm).not.toHaveBeenCalled();
});

test('New exercise creates a custom catalogue entry and the gym exercise; duplicate names are rejected', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  render(<ExerciseEdit gymId={g.id} geId="new" />);
  await user.selectOptions(await screen.findByLabelText('Exercise'), '__new__');
  await user.type(screen.getByLabelText('New exercise name'), 'Leg Press');
  await user.type(screen.getByLabelText('Stack weights'), '10 20');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('An exercise with this name already exists');

  const name = screen.getByLabelText('New exercise name');
  await user.clear(name);
  await user.type(name, 'Sled Pull Thing');
  await user.selectOptions(screen.getByLabelText('New exercise category'), 'back');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await vi.waitFor(async () => expect(await db.gymExercises.count()).toBe(1));
  expect(await db.customCatalog.toArray()).toMatchObject([
    { id: 'sled-pull-thing', name: 'Sled Pull Thing', category: 'back', kind: 'machine', builtIn: false },
  ]);
  expect((await db.gymExercises.toArray())[0].catalogId).toBe('sled-pull-thing');
});

test('free exercise override edits start/step/max and rejects start >= max', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  render(<ExerciseEdit gymId={g.id} geId="new" catalogId="barbell-bench-press" />);
  const start = await screen.findByLabelText('Start (kg)');
  await user.clear(start);
  await user.type(start, '300');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Start must be below max');
  await user.clear(start);
  await user.type(start, '15');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await vi.waitFor(async () => expect(await db.gymExercises.count()).toBe(1));
  expect((await db.gymExercises.toArray())[0]).toMatchObject({
    catalogId: 'barbell-bench-press',
    hidden: false,
    loading: { type: 'free', start: 15, step: 2.5, max: 300 },
  });
});

test('Delete removes the gym exercise and returns to the gym', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  const ge = await saveGymExercise({
    gymId: g.id, catalogId: 'leg-press', label: '', notes: '', loading: { type: 'stack', weights: [10] }, hidden: false,
  });
  render(<ExerciseEdit gymId={g.id} geId={ge.id} />);
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  await vi.waitFor(async () => expect(await db.gymExercises.count()).toBe(0));
  expect(location.hash).toBe(`#/gym/${g.id}`);
});
