import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym, availableExercises, saveGymExercise } from '../../db/gymRepo';
import { getCatalog } from '../../db/catalogRepo';
import { db, resetDb } from '../../db/db';
import { shareOrDownload } from '../lib/share';
import GymDetail from './GymDetail';

vi.mock('../lib/share', async (orig) => ({
  ...(await orig<typeof import('../lib/share')>()),
  shareOrDownload: vi.fn().mockResolvedValue(true),
}));

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
  expect(screen.getByRole('button', { name: 'Import machine files' })).toBeInTheDocument();
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

test('choosing a file through GymDetail opens the import sheet with its preview', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  render(<GymDetail gymId={g.id} />);
  const json = JSON.stringify({
    format: 'rwtm-machine',
    version: 1,
    machines: [{ exercise: 'leg-press', newExercise: null, label: '', loading: { type: 'stack', weights: [5, 10] }, notes: '' }],
  });
  await user.upload(await screen.findByLabelText('Machine file'), new File([json], 'm.json', { type: 'application/json' }));
  expect(await screen.findByText('Leg Press — Legs · Stack 5–10 kg')).toBeInTheDocument();
});

test('Export gym file shares the gym as a machine file with its name', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi Gym');
  await saveGymExercise({
    gymId: g.id, catalogId: 'leg-press', label: 'T', notes: '', loading: { type: 'stack', weights: [10] }, hidden: false,
  });
  render(<GymDetail gymId={g.id} />);
  await user.click(await screen.findByRole('button', { name: 'Export gym file' }));
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalled());
  const [name, blob] = vi.mocked(shareOrDownload).mock.calls.at(-1)!;
  expect(name).toBe('rwtm-gym-kamppi-gym.json');
  const json = JSON.parse(await (blob as Blob).text());
  expect(json).toMatchObject({ format: 'rwtm-machine', gym: { name: 'Kamppi Gym' }, machines: [{ exercise: 'leg-press', label: 'T' }] });
});

test('Replace from file shows what changes and replaces the equipment', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  await saveGymExercise({
    gymId: g.id, catalogId: 'leg-press', label: 'Old', notes: '', loading: { type: 'stack', weights: [10] }, hidden: false,
  });
  render(<GymDetail gymId={g.id} />);
  await user.click(await screen.findByRole('button', { name: 'Replace from file' }));
  const sheet = await screen.findByRole('dialog', { name: 'Replace equipment' });
  await user.click(within(sheet).getByLabelText('Pasted text'));
  await user.paste(
    JSON.stringify({
      format: 'rwtm-machine', version: 1, gym: { name: 'K' },
      machines: [{ exercise: 'lat-pulldown', label: 'New', loading: { type: 'stack', weights: [5, 10] } }],
    }),
  );
  expect(await within(sheet).findByText('0 updated, 1 added, 1 removed')).toBeInTheDocument();
  await user.click(within(sheet).getByRole('button', { name: 'Replace with 1 item' }));
  await vi.waitFor(async () =>
    expect((await db.gymExercises.where('gymId').equals(g.id).toArray()).map((x) => x.label)).toEqual(['New']),
  );
});
