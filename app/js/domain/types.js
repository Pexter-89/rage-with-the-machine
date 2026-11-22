// Shapes of the app's records, as JSDoc types (no runtime code). Other modules refer to them with
// `/** @type {import('./types.js').Gym} */` and the like; they are documentation for readers and editors.

/** @typedef {'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'fullbody'} Category */
/** @typedef {'machine' | 'free' | 'bodyweight'} Kind */
/** What the exercise is done with; drives the picker icon. Defaults from `kind` (see `equipmentOf`).
 * @typedef {'machine' | 'barbell' | 'dumbbell' | 'kettlebell' | 'band' | 'bodyweight'} Equipment */
/** @typedef {'kg' | 'level'} Unit */

/**
 * How weight is put on an exercise.
 * - stack: unit default 'kg'. addOns: small weights some stacks switch in on top (e.g. [2.5]); kg stacks only.
 * - plates: loaded plate by plate: `base` is the bar or sled, each plate goes on `sides` sides (2 = a pair per tap).
 * @typedef {{ type: 'stack', weights: number[], unit?: Unit, addOns?: number[] }
 *   | { type: 'plate', base: number, step: number }
 *   | { type: 'plates', base: number, plates: number[], sides: 1 | 2 }
 *   | { type: 'free', start: number, step: number, max: number, bigStepFrom?: number, bigStep?: number }
 *   | { type: 'bodyweight', step: number, max: number }} Loading
 */

/**
 * @typedef {object} CatalogExercise
 * @property {string} id
 * @property {string} name
 * @property {Category} category
 * @property {Kind} kind
 * @property {Equipment} [equipment]
 * @property {boolean} [unilateral]
 * @property {boolean} [assisted]
 * @property {Loading} [defaultLoading]
 * @property {boolean} builtIn
 */

/**
 * @typedef {object} Gym
 * @property {string} id
 * @property {string} name
 * @property {number} order
 * @property {boolean} archived
 */

/**
 * A machine (or free-weight station) set up at one gym.
 * @typedef {object} GymExercise
 * @property {string} id
 * @property {string} gymId
 * @property {string} catalogId
 * @property {string} label
 * @property {string} notes
 * @property {Loading} loading
 * @property {boolean} hidden
 */

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} gymId
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {number} lastActivityAt
 * @property {number | null} [bodyweight] Body weight in kg, if the user noted it during the session. Absent in older data.
 */

/**
 * @typedef {object} SetEntry
 * @property {string} id
 * @property {string} sessionId
 * @property {string} gymId
 * @property {string} catalogId
 * @property {string | null} gymExerciseId
 * @property {number} order
 * @property {number} weight
 * @property {number} reps
 * @property {number | null} baseWeight
 * @property {Unit} unit
 * @property {number} completedAt
 */

/**
 * One row of the exercise picker.
 * @typedef {object} PickerItem
 * @property {string} key
 * @property {string} catalogId
 * @property {string | null} gymExerciseId
 * @property {string} name
 * @property {string} label
 * @property {string} notes The machine's notes at this gym (seat position etc.); '' for catalogue items.
 * @property {Category} category
 * @property {Equipment} equipment
 * @property {Loading} loading
 * @property {boolean} unilateral
 * @property {boolean} assisted
 */

/**
 * @typedef {object} Settings
 * @property {'system' | 'dark' | 'light'} theme
 * @property {number} autoCloseMinutes
 * @property {number | null} lastBackupAt
 */

export {};
