const MAX_ERROR = 120;

/** The first line of an error's message, truncated, for one-line inline error text. */
export function oneLine(e: unknown, fallback = 'Something went wrong'): string {
  const first = (e instanceof Error ? e.message : String(e)).split('\n')[0].trim() || fallback;
  return first.length > MAX_ERROR ? first.slice(0, MAX_ERROR) + '…' : first;
}
