import { expect, test } from 'vitest';
import { BUILT_IN_CATALOG } from '../../app/js/domain/catalog.js';
import { buildClaudePrompt } from '../../app/js/domain/claudePrompt.js';
import { extractMachineJson, parseMachineFile } from '../../app/js/domain/importMachine.js';

test('prompt lists every catalogue id incl. custom, contains rwtm-machine example and lb/level rules', () => {
  const custom = { id: 'hip-thing', name: 'Hip Thing', category: 'legs', kind: 'machine', builtIn: false };
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
