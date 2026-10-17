import { expect, test } from 'vitest';
import { BUILT_IN_CATALOG } from './catalog';
import { buildClaudePrompt } from './claudePrompt';
import { extractMachineJson, parseMachineFile } from './importMachine';

test('prompt lists every catalogue id incl. custom, contains rwtm-machine example and lb/level rules', () => {
  const custom = { id: 'hip-thing', name: 'Hip Thing', category: 'legs', kind: 'machine', builtIn: false } as const;
  const p = buildClaudePrompt([...BUILT_IN_CATALOG, custom]);
  for (const e of BUILT_IN_CATALOG) expect(p).toContain(`${e.id} — ${e.name} (${e.category}, ${e.kind})`);
  expect(p).toContain('hip-thing — Hip Thing (legs, machine)');
  expect(p).toContain('"format": "rwtm-machine"');
  expect(p).toContain('"newExercise"');
  expect(p).toMatch(/lb/);
  expect(p).toMatch(/0\.1/);
  expect(p).toContain('"unit": "level"');
  expect(p).toMatch(/\.json/);
  expect(p.trimEnd().endsWith('```')).toBe(true);
});

test('the embedded template parses with the importer', () => {
  const json = extractMachineJson(buildClaudePrompt(BUILT_IN_CATALOG));
  expect(json).not.toBeNull();
  expect(parseMachineFile(JSON.stringify(json), BUILT_IN_CATALOG).ok).toBe(true);
});
