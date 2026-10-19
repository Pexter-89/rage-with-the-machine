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
      "loading": { "type": "plates", "base": 62, "plates": [1.25, 2.5, 5, 10, 15, 20, 25], "sides": 2 },
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
2. Only if nothing in the list fits, set "exercise" to a new id and fill "newExercise" with { "id", "name", "category", "kind" }. The new id must match "exercise", be lowercase kebab-case (for example "seated-hip-abductor"), and "category" must be one of: ${categories}. "kind" must be "machine". Otherwise set "newExercise" to null. If a suitable id is already in the list, use it and set newExercise to null; never redefine a listed id.
3. "label" is a short description of this particular machine (brand and model, for example "Technogym Pure leg press"). "notes" holds setup details such as seat height or pin positions. Either may be an empty string.
4. Selectorised (weight stack) machines use "loading": { "type": "stack", "weights": [...] }. List exactly the weight values printed on the stack, in ascending order. If the machine has a small add-on weight that a switch, lever, dial or magnet adds on top of the selected plate (for example "+2 kg" or "+2.5 kg"), add "addOns": [<that weight in kg>] to the loading, one value per separate add-on (at most 3). Leave "addOns" out when there is none.
5. Plate-loaded machines use "loading": { "type": "plates", "base": <weight of the empty sled or carriage in kg>, "plates": [<plate sizes in kg>], "sides": <2 when plates go on both sides in pairs, 1 when there is a single loading horn> }. Read the sled weight from the photo. List the plate sizes seen in the photos; if none are visible use [1.25, 2.5, 5, 10, 15, 20, 25]. Every plate size must be at least 0.25.
6. If the stack weights or the sled weight are not visible in the photo, ask me. Do not guess.
7. If a stack is labelled in pounds (lb), convert every value to kg, rounded to 0.1.
8. If the stack plates are only numbered (1, 2, 3 and so on) with no weights, ask me how many kg each plate is. If I don't know, use "unit": "level" and list the plate numbers as the weights, for example "loading": { "type": "stack", "unit": "level", "weights": [1, 2, 3, 4, 5] }.
9. One file may describe several machines, one entry each in "machines". I may send photos one at a time or many at once: when I send several photos together, reply with one file that lists every machine in them, one entry per machine (a machine seen in several photos is listed once).
10. Reply with one \`\`\`json code block containing the file and use no fields other than those in the template. You may also offer the same content as a downloadable .json file.

The file format, exactly:

\`\`\`json
${TEMPLATE}
\`\`\``;
}
