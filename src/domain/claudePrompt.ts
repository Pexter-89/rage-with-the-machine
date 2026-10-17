import { CATEGORIES } from './catalog';
import type { CatalogExercise } from './types';

const TEMPLATE = `{
  "format": "rwtm-machine",
  "version": 1,
  "machines": [
    {
      "exercise": "leg-press",
      "newExercise": null,
      "label": "Technogym Pure leg press",
      "loading": { "type": "plate", "base": 62, "step": 2.5 },
      "notes": "Seat at notch 5"
    },
    {
      "exercise": "lat-pulldown",
      "newExercise": null,
      "label": "Gym80 lat pulldown",
      "loading": { "type": "stack", "weights": [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100] },
      "notes": ""
    }
  ]
}`;

/** Plain-text prompt the user pastes into the Claude app together with machine photos. */
export function buildClaudePrompt(catalog: CatalogExercise[]): string {
  const list = catalog.map((e) => `${e.id} — ${e.name} (${e.category}, ${e.kind})`).join('\n');
  const categories = CATEGORIES.map((c) => c.id).join(', ');
  return `I'm setting up the gym machines in my workout tracker. I will send you photos of gym machines. For each machine, identify the exercise, read how it is loaded, and reply with a machine file in the exact JSON format at the end of this message.

Exercise list. Each line is: id — name (category, kind)
${list}

Rules:
1. For each machine, pick the "exercise" id from the list above. Use the id exactly as written.
2. Only if nothing in the list fits, set "exercise" to a new id and fill "newExercise" with { "id", "name", "category", "kind" }. The new id must match "exercise", be lowercase kebab-case (for example "seated-hip-abductor"), and "category" must be one of: ${categories}. "kind" must be "machine". Otherwise set "newExercise" to null.
3. "label" is a short description of this particular machine (brand and model, for example "Technogym Pure leg press"). "notes" holds setup details such as seat height or pin positions. Either may be an empty string.
4. Selectorised (weight stack) machines use "loading": { "type": "stack", "weights": [...] }. List exactly the weight values printed on the stack, in ascending order.
5. Plate-loaded machines use "loading": { "type": "plate", "base": <weight of the empty sled or carriage in kg>, "step": <smallest plate increment per load in kg, for example 2.5> }. Read the sled weight from the photo. The step must be at least 0.25.
6. If the stack weights or the sled weight are not visible in the photo, ask me. Do not guess.
7. If a stack is labelled in pounds (lb), convert every value to kg, rounded to 0.1.
8. If the stack plates are only numbered (1, 2, 3 and so on) with no weights, ask me how many kg each plate is. If I don't know, use "unit": "level" and list the plate numbers as the weights, for example "loading": { "type": "stack", "unit": "level", "weights": [1, 2, 3, 4, 5] }.
9. One file may describe several machines, one entry each in "machines".
10. Reply with one \`\`\`json code block containing the file and use no fields other than those in the template. You may also offer the same content as a downloadable .json file.

The file format, exactly:

\`\`\`json
${TEMPLATE}
\`\`\``;
}
