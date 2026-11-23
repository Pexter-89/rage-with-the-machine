import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, resetDb } from '../../../app/js/db/db.js';
import { addGym, saveGymExercise } from '../../../app/js/db/gymRepo.js';
import { addProgram } from '../../../app/js/db/programRepo.js';
import { getOpenSession } from '../../../app/js/db/sessionRepo.js';
import Programs from '../../../app/js/ui/screens/Programs.js';
import { html } from '../../../app/js/lib/html.js';
import { toHash } from '../../../app/js/ui/router.js';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

const T = Date.now();

async function seed() {
  const g = await addGym('Kamppi');
  await saveGymExercise({
    gymId: g.id,
    catalogId: 'leg-press',
    label: 'Technogym',
    notes: '',
    loading: { type: 'stack', weights: [10, 20] },
    hidden: false,
  });
  const legs = await addProgram(
    {
      name: 'Legs',
      items: [
        { catalogId: 'leg-press', sets: 3, reps: 10 },
        { catalogId: 'barbell-back-squat', sets: 5, reps: 5 },
      ],
    },
    T,
  );
  const pull = await addProgram(
    {
      name: 'Pull',
      items: [
        { catalogId: 'lat-pulldown', sets: 3, reps: 12 },
        { catalogId: 'seated-row', sets: 3, reps: 12 },
        { catalogId: 'pull-up', sets: 3, reps: 8 },
      ],
    },
    T,
  );
  return { g, legs, pull };
}

const rowNames = () =>
  screen.getAllByTestId('program-row').map((r) => within(r).getByRole('button', { name: /^Start/ }).getAttribute('aria-label'));

test('lists programs in order with exercise counts and how many this gym lacks', async () => {
  const { g } = await seed();
  render(html`<${Programs} gymId=${g.id} />`);
  expect(await screen.findByText('Programs · Kamppi')).toBeInTheDocument();
  expect(rowNames()).toEqual(['Start Legs', 'Start Pull']);
  const [legs, pull] = screen.getAllByTestId('program-row');
  expect(legs).toHaveTextContent('2 exercises');
  expect(within(legs).queryByText(/not at this gym/)).toBeNull();
  expect(pull).toHaveTextContent('3 exercises');
  expect(within(pull).getByText('2 not at this gym')).toBeInTheDocument();
});

test('archived programs are not listed; with none there is a hint and New program', async () => {
  const g = await addGym('Kamppi');
  const p = await addProgram({ name: 'Old', items: [] }, T);
  await db.programs.update(p.id, { archived: true });
  render(html`<${Programs} gymId=${g.id} />`);
  expect(await screen.findByText(/No programs yet/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /New program/ }));
  expect(location.hash).toBe(toHash({ name: 'program', gymId: g.id, programId: 'new' }));
});

test('tapping a program starts a session from it at this gym', async () => {
  const { g, legs } = await seed();
  render(html`<${Programs} gymId=${g.id} />`);
  await userEvent.click(await screen.findByRole('button', { name: 'Start Legs' }));
  await vi.waitFor(async () => expect(await getOpenSession()).not.toBeNull());
  const s = await getOpenSession();
  expect(s).toMatchObject({ gymId: g.id, programId: legs.id, plan: legs.items });
  expect(location.hash).toBe(toHash({ name: 'session', sessionId: s.id }));
});

test('up/down reorder the list; Edit opens the editor', async () => {
  const user = userEvent.setup();
  const { g, pull } = await seed();
  render(html`<${Programs} gymId=${g.id} />`);
  await screen.findByText('Programs · Kamppi');
  expect(screen.getByRole('button', { name: 'Move Legs up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move Pull down' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Move Pull up' }));
  await vi.waitFor(() => expect(rowNames()).toEqual(['Start Pull', 'Start Legs']));
  await user.click(screen.getByRole('button', { name: 'Edit Pull' }));
  expect(location.hash).toBe(toHash({ name: 'program', gymId: g.id, programId: pull.id }));
});
