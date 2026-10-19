import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, listGyms } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import Gyms from './Gyms';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

const names = () => screen.getAllByTestId('gym-name').map((e) => e.textContent);

test('Gyms: add, rename, move up, archive', async () => {
  const user = userEvent.setup();
  await addGym('Kamppi');
  render(<Gyms />);
  await screen.findByText('Kamppi');

  await user.type(screen.getByLabelText('New gym name'), 'Otaniemi');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await vi.waitFor(() => expect(names()).toEqual(['Kamppi', 'Otaniemi']));

  await user.click(screen.getByRole('button', { name: 'Move Otaniemi up' }));
  await vi.waitFor(() => expect(names()).toEqual(['Otaniemi', 'Kamppi']));

  await user.click(screen.getByRole('button', { name: 'Rename Kamppi' }));
  const input = screen.getByLabelText('Gym name');
  await user.clear(input);
  await user.type(input, 'Kamppi 2');
  await user.click(screen.getByRole('button', { name: 'Save name' }));
  await vi.waitFor(() => expect(names()).toEqual(['Otaniemi', 'Kamppi 2']));

  await user.click(screen.getByRole('button', { name: 'Archive Kamppi 2' }));
  await vi.waitFor(async () => expect((await listGyms()).map((g) => g.name)).toEqual(['Otaniemi']));
  const row = (await screen.findByText('Archived')).closest('li')!;
  expect(within(row).getByRole('button', { name: 'Unarchive Kamppi 2' })).toBeInTheDocument();
});

test('Delete is offered only for gyms without sessions', async () => {
  const a = await addGym('Empty');
  const b = await addGym('Used');
  await db.sessions.add({ id: 's', gymId: b.id, startedAt: 1, endedAt: 2, lastActivityAt: 2 });
  render(<Gyms />);
  await screen.findByText('Used');
  expect(await screen.findByRole('button', { name: 'Delete Empty' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete Used' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Delete Empty' }));
  await vi.waitFor(async () => expect(await db.gyms.get(a.id)).toBeUndefined());
});

test('Import gym from file creates the gym with its equipment and opens it', async () => {
  const user = userEvent.setup();
  render(<Gyms />);
  await user.click(await screen.findByRole('button', { name: 'Import gym from file' }));
  const sheet = await screen.findByRole('dialog', { name: 'Import gym' });
  await user.click(within(sheet).getByLabelText('Pasted text'));
  await user.paste(
    JSON.stringify({
      format: 'rwtm-machine', version: 1, gym: { name: 'Shared gym' },
      machines: [{ exercise: 'lat-pulldown', label: 'A', loading: { type: 'stack', weights: [5, 10] } }],
    }),
  );
  expect(await within(sheet).findByLabelText('Gym name')).toHaveValue('Shared gym');
  await user.click(within(sheet).getByRole('button', { name: 'Create gym' }));
  await vi.waitFor(async () => expect((await listGyms()).map((x) => x.name)).toEqual(['Shared gym']));
  const gym = (await listGyms())[0];
  expect(await db.gymExercises.where('gymId').equals(gym.id).count()).toBe(1);
  await vi.waitFor(() => expect(location.hash).toBe(`#/gym/${gym.id}`));
});
