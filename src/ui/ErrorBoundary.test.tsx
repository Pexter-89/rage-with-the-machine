import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDb } from '../db/db';
import ErrorBoundary from './ErrorBoundary';
import Settings from './screens/Settings';

beforeEach(async () => {
  await resetDb();
  location.hash = '#/gyms';
  // React reports errors caught by a boundary through console.error.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Throws on every route except the ones listed. */
function Boom({ okOn }: { okOn: string[] }) {
  if (!okOn.includes(location.hash)) throw new Error('IndexedDB exploded\nat some stack frame');
  return <p>{`fine on ${location.hash}`}</p>;
}

test('a render throw shows the fallback with the first line of the error', () => {
  render(
    <ErrorBoundary>
      <Boom okOn={[]} />
    </ErrorBoundary>,
  );
  expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('IndexedDB exploded');
  expect(screen.getByRole('alert')).not.toHaveTextContent('stack frame');
});

test('Home navigates to #/ and resets the boundary', async () => {
  const user = userEvent.setup();
  render(
    <ErrorBoundary>
      <Boom okOn={['#/']} />
    </ErrorBoundary>,
  );
  await user.click(screen.getByRole('button', { name: 'Home' }));
  expect(location.hash).toBe('#/');
  expect(screen.getByText('fine on #/')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
});

test('Settings navigates to #/settings, resets the boundary, and the backup controls work there', async () => {
  const user = userEvent.setup();
  function Child() {
    if (location.hash !== '#/settings') throw new Error('broken screen');
    return <Settings />;
  }
  render(
    <ErrorBoundary>
      <Child />
    </ErrorBoundary>,
  );
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(location.hash).toBe('#/settings');
  expect(await screen.findByRole('button', { name: 'Export backup' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Import backup' })).toBeEnabled();
  expect(screen.getByLabelText('Backup file')).toBeInTheDocument();
});
