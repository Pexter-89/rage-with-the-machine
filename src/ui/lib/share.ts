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

/**
 * Shares the file through the OS share sheet when possible, otherwise downloads it.
 * Resolves true when shared or the download was triggered, false when the user cancelled the sheet.
 * A NotAllowedError (user activation lost) falls back to a download; other errors reject.
 */
export async function shareOrDownload(filename: string, blob: Blob): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
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
