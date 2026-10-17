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

test('form controls render at 16px or more so iOS does not zoom into them', () => {
  // `font: inherit` would pick up small label sizes (.field is 0.85rem), so font-size must come after it.
  expect(rule('input')).toMatch(/font:\s*inherit;[\s\S]*font-size:\s*16px/);
  expect(rule('select,\\s*textarea')).toMatch(/font:\s*inherit;[\s\S]*font-size:\s*16px/);
  let checked = 0;
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/\b(input|select|textarea)\b/.test(sel)) continue;
    const m = /font-size:\s*([\d.]+)(px|rem)/.exec(body);
    if (!m) continue;
    checked++;
    expect(m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16, sel.trim()).toBeGreaterThanOrEqual(16);
  }
  expect(checked).toBeGreaterThanOrEqual(3);
});
