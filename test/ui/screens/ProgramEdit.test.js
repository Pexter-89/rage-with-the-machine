import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, resetDb } from '../../../app/js/db/db.js';
import { addGym, saveGymExercise } from '../../../app/js/db/gymRepo.js';
import { addProgram, getProgram, listPrograms } from '../../../app/js/db/programRepo.js';
import ProgramEdit from '../../../app/js/ui/screens/ProgramEdit.js';
import { html } from '../../../app/js/lib/html.js';
import { toHash } from '../../../app/js/ui/router.js';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

async function addExercise(user, name) {
  await user.click(screen.getByRole('button', { name: /Add exercise/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Add exercise' });
  await user.click(within(sheet).getByRole('button', { name, exact: true }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

const itemNames = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'));

test('creates a program: name, exercises from the whole catalogue, sets × reps, order', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  render(html`<${ProgramEdit} gymId=${g.id} programId="new" />`);
  await user.type(await screen.findByLabelText('Program name'), 'Upper');
  // The picker offers machines this gym does not have: programs work at any gym.
  await addExercise(user, 'Chest Press');
  await addExercise(user, 'Pull-Up');
  expect(itemNames()).toEqual(['Chest Press', 'Pull-Up']);
  expect(within(screen.getAllByRole('listitem')[0]).getByText('Not at this gym')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'More sets for Chest Press' }));
  await user.click(screen.getByRole('button', { name: 'Fewer reps for Pull-Up' }));
  await user.click(screen.getByRole('button', { name: 'Fewer reps for Pull-Up' }));
  await user.click(screen.getByRole('button', { name: 'Move Pull-Up up' }));
  expect(itemNames()).toEqual(['Pull-Up', 'Chest Press']);
  expect(screen.getByRole('button', { name: 'Move Pull-Up up' })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: 'Save program' }));
  await vi.waitFor(() => expect(location.hash).toBe(toHash({ name: 'programs', gymId: g.id })));
  const [p] = await listPrograms();
  expect(p).toMatchObject({
    name: 'Upper',
    items: [
      { catalogId: 'pull-up', sets: 3, reps: 8 },
      { catalogId: 'chest-press', sets: 4, reps: 10 },
    ],
  });
});

test('a program needs a name and at least one exercise', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  render(html`<${ProgramEdit} gymId=${g.id} programId="new" />`);
  await user.click(await screen.findByRole('button', { name: 'Save program' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give the program a name');
  await user.type(screen.getByLabelText('Program name'), 'X');
  await user.click(screen.getByRole('button', { name: 'Save program' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Add at least one exercise');
  expect(await db.programs.count()).toBe(0);
  expect(screen.queryByRole('button', { name: 'Delete program' })).toBeNull();
});

test('edits an existing program: steppers stop at their limits, remove, rename', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  await saveGymExercise({
    gymId: g.id,
    catalogId: 'leg-press',
    label: '',
    notes: '',
    loading: { type: 'stack', weights: [10] },
    hidden: false,
  });
  const p = await addProgram(
    {
      name: 'Legs',
      items: [
        { catalogId: 'leg-press', sets: 1, reps: 50 },
        { catalogId: 'goblet-squat', sets: 3, reps: 10 },
      ],
    },
    1,
  );
  render(html`<${ProgramEdit} gymId=${g.id} programId=${p.id} />`);
  expect(await screen.findByDisplayValue('Legs')).toBeInTheDocument();
  expect(screen.getByText('Edit program')).toBeInTheDocument();
  expect(screen.queryByText('Not at this gym')).toBeNull();
  expect(screen.getByRole('button', { name: 'Fewer sets for Leg Press' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'More reps for Leg Press' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Remove Goblet Squat' }));
  expect(itemNames()).toEqual(['Leg Press']);
  await user.clear(screen.getByLabelText('Program name'));
  await user.type(screen.getByLabelText('Program name'), 'Legs 2');
  await user.click(screen.getByRole('button', { name: 'Save program' }));
  await vi.waitFor(() => expect(location.hash).toBe(toHash({ name: 'programs', gymId: g.id })));
  expect(await getProgram(p.id)).toMatchObject({ name: 'Legs 2', items: [{ catalogId: 'leg-press', sets: 1, reps: 50 }] });
});

test('Delete program asks in the in-page sheet, then deletes', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  const p = await addProgram({ name: 'Legs', items: [{ catalogId: 'leg-press', sets: 3, reps: 10 }] }, 1);
  render(html`<${ProgramEdit} gymId=${g.id} programId=${p.id} />`);
  await user.click(await screen.findByRole('button', { name: 'Delete program' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete program?' });
  expect(dialog).toHaveTextContent('Legs will be deleted. Sessions done with it are kept.');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(await getProgram(p.id)).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Delete program' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(async () => expect(await getProgram(p.id)).toBeUndefined());
  expect(location.hash).toBe(toHash({ name: 'programs', gymId: g.id }));
});

test('a program that does not exist goes back to the list', async () => {
  const g = await addGym('Kamppi');
  render(html`<${ProgramEdit} gymId=${g.id} programId="gone" />`);
  await vi.waitFor(() => expect(location.hash).toBe(toHash({ name: 'programs', gymId: g.id })));
});
