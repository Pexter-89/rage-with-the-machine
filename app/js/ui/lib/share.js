/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}

/**
 * @param {string} filename
 * @param {Blob} blob
 */
function download(filename, blob) {
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

/**
 * The Claude artifact `downloads` capability (the subset used here).
 * @typedef {object} ClaudeDownloads
 * @property {(request: { filename: string; data: Blob }) => Promise<{ status: string }>} save
 */

/**
 * The artifact's downloads capability, or null when the page runs outside claude.ai or this view lacks it.
 * @returns {Promise<ClaudeDownloads | null>}
 */
export async function claudeDownloads() {
  try {
    const claude = globalThis.claude;
    if (typeof claude?.use !== 'function') return null;
    return (await claude.use('downloads')) ?? null;
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
 * @param {string} filename
 * @param {Blob} blob
 * @param {() => Promise<ClaudeDownloads | null>} [downloads=claudeDownloads]
 * @returns {Promise<boolean>}
 */
export async function shareOrDownload(filename, blob, downloads = claudeDownloads) {
  const dl = await downloads();
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      return true;
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : 'unavailable';
      if (code === 'declined') return false;
      if (code === 'rate_limited') throw new Error('A save is already waiting for your answer');
      if (!DOWNLOADS_UNAVAILABLE.has(code)) {
        throw new Error(e && typeof e === 'object' && 'message' in e ? String(e.message) : code);
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
