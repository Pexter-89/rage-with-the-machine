import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, availableExercises, saveGymExercise } from '../../db/gymRepo';
import { getCatalog } from '../../db/catalogRepo';
import { db, resetDb } from '../../db/db';
import GymDetail from './GymDetail';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

test('GymDetail lists machines and opens editor', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  const ge = await saveGymExercise({
    gymId: g.id,
    catalogId: 'leg-press',
    label: 'Technogym',
    notes: '',
    loading: { type: 'plate', base: 62, step: 2.5 },
    hidden: false,
  });
  render(<GymDetail gymId={g.id} />);
  expect(await screen.findByRole('heading', { name: 'Kamppi' })).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Leg Press — Technogym' }));
  expect(location.hash).toBe(`#/gym/${g.id}/exercise/${ge.id}`);
  expect(screen.getByRole('button', { name: 'Import machine file' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Paste from Claude' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add manually' }));
  expect(location.hash).toBe(`#/gym/${g.id}/exercise/new`);
});

test('Hide here toggle removes free exercise from availableExercises', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  render(<GymDetail gymId={g.id} />);
  const catalog = await getCatalog();
  const has = async () => (await availableExercises(g.id, catalog)).some((i) => i.catalogId === 'push-up');

  expect(await has()).toBe(true);
  await user.click(await screen.findByRole('button', { name: 'Hide Push-Up here' }));
  await vi.waitFor(async () => expect(await has()).toBe(false));
  expect(await db.gymExercises.where('gymId').equals(g.id).count()).toBe(1);

  await user.click(await screen.findByRole('button', { name: 'Show Push-Up here' }));
  await vi.waitFor(async () => expect(await has()).toBe(true));
  expect(await db.gymExercises.where('gymId').equals(g.id).count()).toBe(1);
});

test('tapping a free exercise name opens the editor for its override', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  render(<GymDetail gymId={g.id} />);
  await user.click(await screen.findByRole('button', { name: 'Push-Up' }));
  expect(location.hash).toBe(`#/gym/${g.id}/exercise/new?catalog=push-up`);
});
