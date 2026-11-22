import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportSheet from '../../../app/js/ui/components/ExportSheet.js';
import { shareOrDownload } from '../../../app/js/ui/lib/share.js';
import { html } from '../../../app/js/lib/html.js';

vi.mock('../../../app/js/ui/lib/share.js', async (orig) => ({
  ...(await orig()),
  shareOrDownload: vi.fn(async () => true),
}));

const item = (onDone) => ({
  title: 'Export thing',
  filename: 'thing.json',
  text: '{"thing": 1}',
  blob: new Blob(['{"thing": 1}'], { type: 'application/json' }),
  onDone,
});

test('shows the text read-only; Copy copies it, confirms and reports done', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(html`<${ExportSheet} item=${item(onDone)} onClose=${() => {}} />`);
  const area = screen.getByLabelText('Export text');
  expect(area.readOnly).toBe(true);
  expect(area.value).toBe('{"thing": 1}');
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Copied');
  expect(await navigator.clipboard.readText()).toBe('{"thing": 1}');
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('without a usable clipboard, Copy selects the text and says to copy it by hand', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(html`<${ExportSheet} item=${item(onDone)} onClose=${() => {}} />`);
  // Some app views have no clipboard at all: writeText throws instead of rejecting.
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => {
    throw new Error('no clipboard');
  });
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Select all and copy');
  const area = screen.getByLabelText('Export text');
  expect(document.activeElement).toBe(area);
  expect([area.selectionStart, area.selectionEnd]).toEqual([0, area.value.length]);
  expect(onDone).not.toHaveBeenCalled();
});

test('Save file saves the blob under the filename; a cancel is not reported done', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  vi.mocked(shareOrDownload).mockResolvedValueOnce(false);
  render(html`<${ExportSheet} item=${item(onDone)} onClose=${() => {}} />`);
  await user.click(screen.getByRole('button', { name: 'Save file' }));
  await vi.waitFor(() => expect(shareOrDownload).toHaveBeenCalledWith('thing.json', expect.any(Blob)));
  expect(onDone).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save file' }));
  expect(await screen.findByText('Saved')).toBeInTheDocument();
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('renders nothing without an item', () => {
  render(html`<${ExportSheet} item=${null} onClose=${() => {}} />`);
  expect(screen.queryByRole('dialog')).toBeNull();
});
