/**
 * Returns the end index (inclusive) of the object starting at `start`, skipping string literals; -1 if unbalanced.
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
export function matchingBrace(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Parses JSON that was pasted or read from a file. Claude's replies often wrap the JSON in a ```json fence
 * or a sentence, so when the whole text is not JSON, the first fenced block and then the first top-level
 * `{...}` object are tried. Throws an Error with a one-line reason when nothing parses.
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonText(text) {
  const whole = text.replace(/^﻿/, '').trim();
  if (whole === '') throw new Error('Nothing to read: the text is empty');
  let firstError;
  const attempt = (s) => {
    try {
      return { value: JSON.parse(s) };
    } catch (e) {
      firstError ??= e;
      return null;
    }
  };
  const direct = attempt(whole);
  if (direct) return direct.value;

  const fence = /```[a-zA-Z]*\s*\n([\s\S]*?)```/.exec(whole);
  const fenced = fence && attempt(fence[1].trim());
  if (fenced) return fenced.value;

  const start = whole.indexOf('{');
  if (start === -1) throw new Error('No JSON found: expected text starting with {');
  const end = matchingBrace(whole, start);
  if (end !== -1) {
    const obj = attempt(whole.slice(start, end + 1));
    if (obj) return obj.value;
  } else {
    throw new Error('The JSON is cut off: it has no closing }');
  }
  throw new Error(`Not valid JSON: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
}
