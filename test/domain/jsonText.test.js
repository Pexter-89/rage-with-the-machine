import { parseJsonText } from '../../app/js/domain/jsonText.js';

test('plain JSON parses as is (a leading BOM and whitespace are ignored)', () => {
  expect(parseJsonText('﻿  {"a": 1}\n')).toEqual({ a: 1 });
  expect(parseJsonText('[1, 2]')).toEqual([1, 2]);
});

test('a ```json fenced block with prose around it gives the fenced JSON', () => {
  const text = 'Sure! Here it is:\n\n```json\n{"a": {"b": "}"}}\n```\n\nLet me know {if} you need more.';
  expect(parseJsonText(text)).toEqual({ a: { b: '}' } });
});

test('without a fence, the first top-level object in the prose is used', () => {
  expect(parseJsonText('Backup: {"x": [1, {"y": 2}]} and then {"z": 3}')).toEqual({ x: [1, { y: 2 }] });
});

test('clear errors for empty, missing, cut-off and broken JSON', () => {
  expect(() => parseJsonText('   ')).toThrow('Nothing to read');
  expect(() => parseJsonText('no json here')).toThrow('No JSON found');
  expect(() => parseJsonText('{"a": 1, "b": [')).toThrow('The JSON is cut off');
  expect(() => parseJsonText('{"a": 1,}')).toThrow(/^Not valid JSON: /);
});
