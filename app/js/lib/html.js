import { createElement, Fragment } from 'react';
import htm from 'htm';

/**
 * JSX without a build step. Write markup in a tagged template:
 *
 *   html`<button className="btn" onClick=${go}>Go</button>`
 *   html`<${Sheet} title="Edit" onClose=${close}>...</${Sheet}>`   (components go in ${})
 *   html`<${Fragment}>...</${Fragment}>`                              (instead of <>...</>)
 *
 * Attributes use React names (className, onClick, htmlFor), values in ${} are passed as-is, and
 * `...${props}` spreads props. Whitespace that contains a newline at the start or end of a text run is
 * dropped, like JSX; HTML entities are not decoded, so type the character itself (&, ×, ·).
 */
export const html = htm.bind(createElement);

export { Fragment };
