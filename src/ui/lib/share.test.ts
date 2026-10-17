import { readFileText, shareOrDownload } from './share';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('readFileText reads the file as text', async () => {
  expect(await readFileText(new File(['héllo'], 'a.txt'))).toBe('héllo');
});

test('shareOrDownload uses navigator.share when files can be shared', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { canShare: () => true, share });
  await shareOrDownload('x.csv', new Blob(['a'], { type: 'text/csv' }));
  const arg = share.mock.calls[0][0];
  expect(arg.files[0].name).toBe('x.csv');
  expect(arg.files[0].type).toBe('text/csv');
});

test('shareOrDownload swallows AbortError but rethrows others', async () => {
  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(abort) });
  await expect(shareOrDownload('x.csv', new Blob(['a']))).resolves.toBeUndefined();
  vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(new Error('boom')) });
  await expect(shareOrDownload('x.csv', new Blob(['a']))).rejects.toThrow('boom');
});

test('shareOrDownload falls back to a download link and revokes the URL', async () => {
  vi.stubGlobal('navigator', {});
  URL.createObjectURL = vi.fn(() => 'blob:abc');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('x.csv');
    expect(this.href).toBe('blob:abc');
  });
  await shareOrDownload('x.csv', new Blob(['a']));
  expect(click).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:abc');
});
