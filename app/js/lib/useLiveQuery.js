import { useEffect, useMemo, useReducer, useRef } from 'react';
import { liveQuery } from 'dexie';

/**
 * `useLiveQuery(querier, deps, defaultResult)`: runs a Dexie query and re-renders whenever the tables it
 * read change. Returns `defaultResult` (usually undefined) until the first result, and throws the query's
 * error so an ErrorBoundary can catch it.
 *
 * A small port of dexie-react-hooks' useLiveQuery/useObservable (Apache-2.0, David Fahlander), kept here
 * so the page loads React exactly once from the import map instead of a second copy through that package.
 *
 * @template T
 * @param {() => Promise<T> | T} querier
 * @param {unknown[]} [deps]
 * @param {T} [defaultResult]
 * @returns {T | undefined}
 */
export function useLiveQuery(querier, deps = [], defaultResult) {
  const monitor = useRef({ hasResult: false, result: defaultResult, error: null });
  const [, triggerUpdate] = useReducer((x) => x + 1, 0);

  // A new observable whenever deps change; the previous result stays on screen until the new one arrives.
  const observable = useMemo(() => {
    const o = liveQuery(querier);
    // Use a value the observable already holds (if any) on the first render.
    if (!monitor.current.hasResult && typeof window !== 'undefined') {
      if (typeof o.hasValue !== 'function' || o.hasValue()) {
        if (typeof o.getValue === 'function') {
          monitor.current.result = o.getValue();
          monitor.current.hasResult = true;
        } else {
          const sub = o.subscribe((val) => {
            monitor.current.result = val;
            monitor.current.hasResult = true;
          });
          sub.unsubscribe();
        }
      }
    }
    return o;
  }, deps);

  useEffect(() => {
    const sub = observable.subscribe(
      (val) => {
        const current = monitor.current;
        if (current.error !== null || current.result !== val) {
          current.error = null;
          current.result = val;
          current.hasResult = true;
          triggerUpdate();
        }
      },
      (err) => {
        const current = monitor.current;
        if (current.error !== err) {
          current.error = err;
          triggerUpdate();
        }
      },
    );
    return () => sub.unsubscribe();
  }, deps);

  if (monitor.current.error) throw monitor.current.error;
  return monitor.current.result;
}
