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
  await expect(shareOrDownload('x.csv', new Blob(['a'], { type: 'text/csv' }))).resolves.toBe(true);
  const arg = share.mock.calls[0][0];
  expect(arg.files[0].name).toBe('x.csv');
  expect(arg.files[0].type).toBe('text/csv');
});

test('shareOrDownload returns false when the user cancels (AbortError) but rethrows others', async () => {
  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(abort) });
  await expect(shareOrDownload('x.csv', new Blob(['a']))).resolves.toBe(false);
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
  vi.useFakeTimers();
  try {
    expect(await shareOrDownload('x.csv', new Blob(['a']))).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:abc');
  } finally {
    vi.useRealTimers();
  }
});

test('shareOrDownload falls back to download when share is NotAllowedError', async () => {
  const err = Object.assign(new Error('no activation'), { name: 'NotAllowedError' });
  vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(err) });
  URL.createObjectURL = vi.fn(() => 'blob:abc');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await shareOrDownload('x.csv', new Blob(['a']))).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
});
