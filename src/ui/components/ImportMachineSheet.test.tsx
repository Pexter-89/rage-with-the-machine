import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGym } from '../../db/gymRepo';
import { db, resetDb } from '../../db/db';
import ImportMachineSheet from './ImportMachineSheet';

const mocks = vi.hoisted(() => ({ fail: null as null | string }));
vi.mock('../../db/gymRepo', async (orig) => {
  const real = await orig<typeof import('../../db/gymRepo')>();
  return {
    ...real,
    importMachines: (...a: Parameters<typeof real.importMachines>) => {
      if (mocks.fail) return Promise.reject(new Error(mocks.fail));
      return real.importMachines(...a);
    },
  };
});

beforeEach(async () => {
  mocks.fail = null;
  await resetDb();
});

const FILE = {
  format: 'rwtm-machine',
  version: 1,
  machines: [
    {
      exercise: 'leg-press',
      newExercise: null,
      label: 'Technogym',
      loading: { type: 'plate', base: 62, step: 2.5 },
      notes: 'Seat 5',
    },
    {
      exercise: 'sled-pull',
      newExercise: { id: 'sled-pull', name: 'Sled Pull', category: 'legs', kind: 'machine' },
      label: '',
      loading: { type: 'stack', weights: [5, 10, 100] },
      notes: '',
    },
  ],
};
const md = 'Here you go:\n```json\n' + JSON.stringify(FILE, null, 2) + '\n```\n';

test('ImportMachineSheet: pasted markdown → preview → Import creates gym exercise and calls onImported', async () => {
  const user = userEvent.setup();
  const g = await addGym('Kamppi');
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(<ImportMachineSheet gymId={g.id} onClose={onClose} onImported={onImported} />);

  await user.click(screen.getByLabelText('Pasted text'));
  await user.paste(md);
  expect(await screen.findByText('Leg Press — Legs · Plate, sled 62 kg, +2.5')).toBeInTheDocument();
  expect(screen.getByText('Sled Pull — Legs · Stack 5–100 kg')).toBeInTheDocument();
  expect(screen.getByText('New: Sled Pull')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Import' }));
  await vi.waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  expect(onImported.mock.calls[0][0]).toHaveLength(2);
  expect(await db.gymExercises.where('gymId').equals(g.id).count()).toBe(2);
  expect(await db.customCatalog.count()).toBe(1);
  expect(onClose).toHaveBeenCalled();
});

test('level stacks are summarised with L', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  const f = { ...FILE, machines: [{ ...FILE.machines[0], loading: { type: 'stack', unit: 'level', weights: [1, 2, 20] } }] };
  render(<ImportMachineSheet gymId={g.id} onClose={() => {}} onImported={() => {}} />);
  await user.click(screen.getByLabelText('Pasted text'));
  await user.paste(JSON.stringify(f));
  expect(await screen.findByText('Leg Press — Legs · Stack 1–20 L')).toBeInTheDocument();
});

test('file input is parsed like pasted text', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  render(<ImportMachineSheet gymId={g.id} onClose={() => {}} onImported={() => {}} />);
  const input = screen.getByLabelText('Machine file') as HTMLInputElement;
  expect(input.accept).toContain('.json');
  await user.upload(input, new File([md], 'm.md', { type: 'text/markdown' }));
  expect(await screen.findByText('New: Sled Pull')).toBeInTheDocument();
});

test('ImportMachineSheet: bad file shows one-line error and imports nothing', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  const onImported = vi.fn();
  render(<ImportMachineSheet gymId={g.id} onClose={() => {}} onImported={onImported} />);
  await user.click(screen.getByLabelText('Pasted text'));
  await user.paste(JSON.stringify({ ...FILE, extra: 1 }));
  expect(await screen.findByText('unknown field "extra"')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  expect(onImported).not.toHaveBeenCalled();
  expect(await db.gymExercises.count()).toBe(0);
});

test('an import failure is shown as one truncated line and nothing is reported imported', async () => {
  const user = userEvent.setup();
  const g = await addGym('K');
  mocks.fail = 'first line ' + 'x'.repeat(200) + '\nsecond line';
  const onImported = vi.fn();
  render(<ImportMachineSheet gymId={g.id} onClose={() => {}} onImported={onImported} />);
  await user.click(screen.getByLabelText('Pasted text'));
  await user.paste(md);
  await user.click(await screen.findByRole('button', { name: 'Import' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).not.toContain('second line');
  expect(alert.textContent!.length).toBeLessThanOrEqual(121);
  expect(onImported).not.toHaveBeenCalled();
});

test('Paste button appears only with clipboard.readText and reads into the area', async () => {
  const g = await addGym('K');
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  const first = render(<ImportMachineSheet gymId={g.id} onClose={() => {}} onImported={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
  first.unmount();

  const user = userEvent.setup();
  const readText = vi.fn().mockResolvedValue(md);
  Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
  try {
    render(<ImportMachineSheet gymId={g.id} onClose={() => {}} onImported={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByText('New: Sled Pull')).toBeInTheDocument();
  } finally {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  }
});
