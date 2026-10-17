export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}

/** Shares the file through the OS share sheet when possible, otherwise downloads it. Cancelling the sheet is not an error. */
export async function shareOrDownload(filename: string, blob: Blob): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) throw e;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
