import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The browser loads libraries through the import map in app/index.html; the tests use node_modules.
// Both must be the same versions, and React must come from one URL only.
const page = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const imports = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(page)[1]).imports;
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

test('every import-map URL is an exact jsdelivr /+esm version matching package.json', () => {
  for (const [spec, url] of Object.entries(imports)) {
    const m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)(\/[^+]*)?\/\+esm$/.exec(url);
    expect(m, url).not.toBeNull();
    const [, name, version] = m;
    expect(spec === name || spec.startsWith(name + '/'), `${spec} -> ${url}`).toBe(true);
    expect(pkg.dependencies[name], name).toBe(version);
    const installed = JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules', name, 'package.json'), 'utf8'));
    expect(installed.version, name).toBe(version);
  }
});

test('react and react-dom are the same version, so react-dom imports the mapped react URL', () => {
  const v = (s) => /@(\d+\.\d+\.\d+)\//.exec(imports[s])[1];
  expect(v('react-dom/client')).toBe(v('react'));
  expect(imports.react).toBe(`https://cdn.jsdelivr.net/npm/react@${v('react')}/+esm`);
});
