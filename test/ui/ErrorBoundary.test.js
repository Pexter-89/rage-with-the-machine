import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDb } from '../../app/js/db/db.js';
import ErrorBoundary from '../../app/js/ui/ErrorBoundary.js';
import Settings from '../../app/js/ui/screens/Settings.js';
import { html } from '../../app/js/lib/html.js';

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
function Boom({ okOn }) {
  if (!okOn.includes(location.hash)) throw new Error('IndexedDB exploded\nat some stack frame');
  return html`<p>${`fine on ${location.hash}`}</p>`;
}

test('a render throw shows the fallback with the first line of the error', () => {
  render(
    html`
    <${ErrorBoundary}>
      <${Boom} okOn=${[]} />
    </${ErrorBoundary}>
  `,
  );
  expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('IndexedDB exploded');
  expect(screen.getByRole('alert')).not.toHaveTextContent('stack frame');
});

test('Home navigates to #home and resets the boundary', async () => {
  const user = userEvent.setup();
  render(
    html`
    <${ErrorBoundary}>
      <${Boom} okOn=${['#home']} />
    </${ErrorBoundary}>
  `,
  );
  await user.click(screen.getByRole('button', { name: 'Home' }));
  expect(location.hash).toBe('#home');
  expect(screen.getByText('fine on #home')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
});

test('Settings navigates to #prefs, resets the boundary, and the backup controls work there', async () => {
  const user = userEvent.setup();
  function Child() {
    if (location.hash !== '#prefs') throw new Error('broken screen');
    return html`<${Settings} />`;
  }
  render(
    html`
    <${ErrorBoundary}>
      <${Child} />
    </${ErrorBoundary}>
  `,
  );
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(location.hash).toBe('#prefs');
  expect(await screen.findByRole('button', { name: 'Export backup' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Choose file' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Paste' })).toBeEnabled();
  expect(screen.getByLabelText('Backup file')).toBeInTheDocument();
});
