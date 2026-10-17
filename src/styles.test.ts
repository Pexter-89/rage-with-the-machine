import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/** Declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): string {
  const re = new RegExp('(?:^|\\})\\s*' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}', 'm');
  return re.exec(css)?.[1] ?? '';
}

test('safe-area insets live inside the full-height screen box, not on body', () => {
  expect(rule('body')).not.toBe('');
  expect(rule('body')).not.toMatch(/safe-area-inset/);
  expect(rule('.screen')).toMatch(/safe-area-inset-top/);
  expect(rule('.screen')).toMatch(/safe-area-inset-bottom/);
  expect(rule('.screen')).toMatch(/box-sizing:\s*border-box/);
});
