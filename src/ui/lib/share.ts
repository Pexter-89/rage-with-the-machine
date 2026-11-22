import { IS_ARTIFACT } from '../../env';

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke later: some browsers start the download asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** The Claude artifact `downloads` capability (the subset used here). */
export interface ClaudeDownloads {
  save(request: { filename: string; data: Blob }): Promise<{ status: string }>;
}

/** The artifact's downloads capability, or null outside the artifact build or when this view lacks it. */
export async function claudeDownloads(): Promise<ClaudeDownloads | null> {
  if (!IS_ARTIFACT) return null;
  try {
    const claude = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
    if (typeof claude?.use !== 'function') return null;
    return ((await claude.use('downloads')) as ClaudeDownloads | null) ?? null;
  } catch {
    return null;
  }
}

/** Codes after which the platform save can't work in this view, so the browser's own paths are tried. */
const DOWNLOADS_UNAVAILABLE = new Set(['unavailable', 'not_granted', 'capability_disabled', 'capability_removed']);

/**
 * Shares the file through the OS share sheet when possible, otherwise downloads it. In the Claude artifact
 * the platform's save prompt (downloads capability) comes first, since a sandboxed frame can't share or
 * download by itself.
 * Resolves true when shared or the download was triggered, false when the user cancelled the sheet.
 * A NotAllowedError (user activation lost) falls back to a download; other errors reject.
 */
export async function shareOrDownload(
  filename: string,
  blob: Blob,
  downloads: () => Promise<ClaudeDownloads | null> = claudeDownloads,
): Promise<boolean> {
  const dl = await downloads();
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      return true;
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : 'unavailable';
      if (code === 'declined') return false;
      if (code === 'rate_limited') throw new Error('A save is already waiting for your answer');
      if (!DOWNLOADS_UNAVAILABLE.has(code)) {
        throw new Error(e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : code);
      }
    }
  }
  const file = new File([blob], filename, { type: blob.type });
  let canShare = false;
  try {
    canShare = !!navigator.canShare?.({ files: [file] });
  } catch {
    // a frame without the web-share permission may throw here
  }
  if (canShare) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'AbortError') return false;
      if (name !== 'NotAllowedError') throw e;
    }
  }
  download(filename, blob);
  return true;
}
