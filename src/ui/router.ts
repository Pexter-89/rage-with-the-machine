import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'session'; sessionId: string }
  | { name: 'pick'; sessionId: string }
  | { name: 'log'; sessionId: string; key: string }
  | { name: 'gyms' }
  | { name: 'gym'; gymId: string }
  | { name: 'exercise'; gymId: string; geId: string | 'new'; catalogId?: string }
  | { name: 'progress' }
  | { name: 'settings' };

const enc = encodeURIComponent;

export function toHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'session':
      return `#/session/${enc(r.sessionId)}`;
    case 'pick':
      return `#/session/${enc(r.sessionId)}/pick`;
    case 'log':
      return `#/session/${enc(r.sessionId)}/log/${enc(r.key)}`;
    case 'gyms':
      return '#/gyms';
    case 'gym':
      return `#/gym/${enc(r.gymId)}`;
    case 'exercise':
      return `#/gym/${enc(r.gymId)}/exercise/${enc(r.geId)}` + (r.catalogId ? `?catalog=${enc(r.catalogId)}` : '');
    case 'progress':
      return '#/progress';
    case 'settings':
      return '#/settings';
  }
}

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  try {
    const d = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (d[0] === 'session' && d[1]) {
      if (d.length === 2) return { name: 'session', sessionId: d[1] };
      if (d.length === 3 && d[2] === 'pick') return { name: 'pick', sessionId: d[1] };
      if (d.length === 4 && d[2] === 'log') return { name: 'log', sessionId: d[1], key: d[3] };
    } else if (d[0] === 'gyms' && d.length === 1) {
      return { name: 'gyms' };
    } else if (d[0] === 'gym' && d[1]) {
      if (d.length === 2) return { name: 'gym', gymId: d[1] };
      if (d.length === 4 && d[2] === 'exercise') {
        const catalogId = new URLSearchParams(query).get('catalog') ?? undefined;
        return catalogId
          ? { name: 'exercise', gymId: d[1], geId: d[3], catalogId }
          : { name: 'exercise', gymId: d[1], geId: d[3] };
      }
    } else if (d[0] === 'progress' && d.length === 1) {
      return { name: 'progress' };
    } else if (d[0] === 'settings' && d.length === 1) {
      return { name: 'settings' };
    }
  } catch {
    // malformed percent-encoding falls through to home
  }
  return { name: 'home' };
}

export function navigate(r: Route): void {
  location.hash = toHash(r);
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    on();
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parseRoute(hash);
}
