import type { Category, CatalogExercise, Equipment, Kind, Loading } from './types';

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'legs', name: 'Legs' },
  { id: 'chest', name: 'Chest' },
  { id: 'back', name: 'Back' },
  { id: 'shoulders', name: 'Shoulders' },
  { id: 'arms', name: 'Arms' },
  { id: 'core', name: 'Core' },
  { id: 'fullbody', name: 'Full body' },
];

export const DUMBBELL_LOADING: Loading = { type: 'free', start: 1, step: 1, max: 60, bigStepFrom: 10, bigStep: 2 };
/** Standard plates, loaded in pairs. */
export const DEFAULT_PLATES = [2.5, 5, 10, 15, 20, 25];
export const BARBELL_LOADING: Loading = { type: 'plates', base: 20, plates: DEFAULT_PLATES, sides: 2 };
const EZ_BAR_LOADING: Loading = { type: 'plates', base: 10, plates: DEFAULT_PLATES, sides: 2 };
/** Band resistance, by the gym's colour or level numbering. */
export const BAND_LOADING: Loading = { type: 'stack', unit: 'level', weights: [1, 2, 3, 4, 5] };
export const BODYWEIGHT_LOADING: Loading = { type: 'bodyweight', step: 2.5, max: 100 };
const KETTLEBELL_LOADING: Loading = { type: 'free', start: 4, step: 4, max: 48 };

type Flags = Pick<CatalogExercise, 'unilateral' | 'assisted'>;

const make = (
  id: string,
  name: string,
  category: Category,
  kind: Kind,
  equipment: Equipment,
  defaultLoading?: Loading,
  flags: Flags = {},
): CatalogExercise => ({
  id,
  name,
  category,
  kind,
  equipment,
  ...flags,
  ...(defaultLoading ? { defaultLoading } : {}),
  builtIn: true,
});

// Machines and cable stations: loading is per gym, so no default.
const machine = (id: string, name: string, category: Category, flags?: Flags) =>
  make(id, name, category, 'machine', 'machine', undefined, flags);
const dumbbell = (id: string, name: string, category: Category, flags?: Flags) =>
  make(id, name, category, 'free', 'dumbbell', DUMBBELL_LOADING, flags);
const barbell = (id: string, name: string, category: Category, flags?: Flags, loading: Loading = BARBELL_LOADING) =>
  make(id, name, category, 'free', 'barbell', loading, flags);
const kettlebell = (id: string, name: string, category: Category, flags?: Flags) =>
  make(id, name, category, 'free', 'kettlebell', KETTLEBELL_LOADING, flags);
const band = (id: string, name: string, category: Category, flags?: Flags) =>
  make(id, name, category, 'free', 'band', BAND_LOADING, flags);
const bodyweight = (id: string, name: string, category: Category, flags?: Flags) =>
  make(id, name, category, 'bodyweight', 'bodyweight', BODYWEIGHT_LOADING, flags);

/** Equipment of a catalogue entry; custom (imported) entries are machines. */
export function equipmentOf(e: Pick<CatalogExercise, 'kind' | 'equipment'>): Equipment {
  if (e.equipment) return e.equipment;
  return e.kind === 'bodyweight' ? 'bodyweight' : e.kind === 'free' ? 'dumbbell' : 'machine';
}

export const BUILT_IN_CATALOG: CatalogExercise[] = [
  // Legs
  machine('leg-press', 'Leg Press', 'legs'),
  machine('hack-squat', 'Hack Squat', 'legs'),
  machine('leg-extension', 'Leg Extension', 'legs'),
  machine('seated-leg-curl', 'Seated Leg Curl', 'legs'),
  machine('lying-leg-curl', 'Lying Leg Curl', 'legs'),
  machine('hip-abduction', 'Hip Abduction', 'legs'),
  machine('hip-adduction', 'Hip Adduction', 'legs'),
  machine('seated-calf-raise', 'Seated Calf Raise', 'legs'),
  machine('cable-glute-kickback', 'Cable Glute Kickback', 'legs', { unilateral: true }),
  barbell('barbell-back-squat', 'Barbell Back Squat', 'legs'),
  barbell('barbell-front-squat', 'Barbell Front Squat', 'legs'),
  barbell('romanian-deadlift', 'Romanian Deadlift', 'legs'),
  barbell('barbell-hip-thrust', 'Barbell Hip Thrust', 'legs'),
  kettlebell('goblet-squat', 'Goblet Squat', 'legs'),
  dumbbell('dumbbell-lunge', 'Dumbbell Lunge', 'legs', { unilateral: true }),
  dumbbell('bulgarian-split-squat', 'Bulgarian Split Squat', 'legs', { unilateral: true }),
  dumbbell('dumbbell-step-up', 'Dumbbell Step-Up', 'legs', { unilateral: true }),
  // Chest
  machine('chest-press', 'Chest Press', 'chest'),
  machine('incline-chest-press', 'Incline Chest Press', 'chest'),
  machine('pec-deck', 'Pec Deck', 'chest'),
  machine('cable-crossover', 'Cable Crossover', 'chest'),
  machine('cable-chest-fly', 'Cable Chest Fly', 'chest'),
  barbell('barbell-bench-press', 'Barbell Bench Press', 'chest'),
  barbell('incline-barbell-bench-press', 'Incline Barbell Bench Press', 'chest'),
  dumbbell('dumbbell-bench-press', 'Dumbbell Bench Press', 'chest'),
  dumbbell('incline-dumbbell-bench-press', 'Incline Dumbbell Bench Press', 'chest'),
  dumbbell('dumbbell-fly', 'Dumbbell Fly', 'chest'),
  bodyweight('push-up', 'Push-Up', 'chest'),
  bodyweight('chest-dip', 'Chest Dip', 'chest'),
  // Back
  machine('lat-pulldown', 'Lat Pulldown', 'back'),
  machine('close-grip-lat-pulldown', 'Close-Grip Lat Pulldown', 'back'),
  machine('seated-row', 'Seated Row', 'back'),
  machine('cable-row', 'Cable Row', 'back'),
  machine('straight-arm-pulldown', 'Straight-Arm Pulldown', 'back'),
  machine('assisted-pull-up', 'Assisted Pull-Up', 'back', { assisted: true }),
  barbell('barbell-row', 'Barbell Row', 'back'),
  dumbbell('one-arm-dumbbell-row', 'One-Arm Dumbbell Row', 'back', { unilateral: true }),
  dumbbell('dumbbell-pullover', 'Dumbbell Pullover', 'back'),
  bodyweight('pull-up', 'Pull-Up', 'back'),
  bodyweight('chin-up', 'Chin-Up', 'back'),
  // Shoulders
  machine('shoulder-press-machine', 'Shoulder Press Machine', 'shoulders'),
  machine('reverse-pec-deck', 'Reverse Pec Deck', 'shoulders'),
  machine('cable-face-pull', 'Cable Face Pull', 'shoulders'),
  machine('cable-lateral-raise', 'Cable Lateral Raise', 'shoulders', { unilateral: true }),
  barbell('overhead-press', 'Overhead Press', 'shoulders'),
  barbell('barbell-upright-row', 'Barbell Upright Row', 'shoulders'),
  dumbbell('dumbbell-shoulder-press', 'Dumbbell Shoulder Press', 'shoulders'),
  dumbbell('dumbbell-lateral-raise', 'Dumbbell Lateral Raise', 'shoulders'),
  dumbbell('rear-delt-fly', 'Rear Delt Fly', 'shoulders'),
  // Arms
  machine('cable-triceps-pushdown', 'Cable Triceps Pushdown', 'arms'),
  machine('cable-overhead-triceps-extension', 'Cable Overhead Triceps Extension', 'arms'),
  machine('cable-biceps-curl', 'Cable Biceps Curl', 'arms'),
  machine('preacher-curl-machine', 'Preacher Curl Machine', 'arms'),
  machine('assisted-dip', 'Assisted Dip', 'arms', { assisted: true }),
  barbell('barbell-curl', 'Barbell Curl', 'arms'),
  barbell('ez-bar-curl', 'EZ-Bar Curl', 'arms', {}, EZ_BAR_LOADING),
  barbell('skull-crusher', 'Skull Crusher', 'arms', {}, EZ_BAR_LOADING),
  dumbbell('dumbbell-curl', 'Dumbbell Curl', 'arms'),
  dumbbell('hammer-curl', 'Hammer Curl', 'arms'),
  dumbbell('dumbbell-triceps-extension', 'Dumbbell Triceps Extension', 'arms'),
  bodyweight('triceps-dip', 'Triceps Dip', 'arms'),
  // Core (abs and lower back)
  machine('ab-crunch-machine', 'Ab Crunch Machine', 'core'),
  machine('cable-crunch', 'Cable Crunch', 'core'),
  machine('cable-woodchop', 'Cable Woodchop', 'core', { unilateral: true }),
  machine('rotary-torso', 'Rotary Torso', 'core', { unilateral: true }),
  bodyweight('hanging-leg-raise', 'Hanging Leg Raise', 'core'),
  bodyweight('crunch', 'Crunch', 'core'),
  bodyweight('plank', 'Plank', 'core'),
  bodyweight('ab-wheel-rollout', 'Ab Wheel Rollout', 'core'),
  bodyweight('back-extension', 'Back Extension', 'core'),
  // Full body
  barbell('deadlift', 'Deadlift', 'fullbody'),
  barbell('sumo-deadlift', 'Sumo Deadlift', 'fullbody'),
  barbell('clean', 'Clean', 'fullbody'),
  barbell('power-clean', 'Power Clean', 'fullbody'),
  barbell('thruster', 'Thruster', 'fullbody'),
  kettlebell('kettlebell-swing', 'Kettlebell Swing', 'fullbody'),
  kettlebell('turkish-get-up', 'Turkish Get-Up', 'fullbody', { unilateral: true }),
  kettlebell('farmers-carry', "Farmer's Carry", 'fullbody'),
  bodyweight('burpee', 'Burpee', 'fullbody'),
  // Resistance bands
  band('band-lateral-walk', 'Band Lateral Walk', 'legs'),
  band('band-chest-press', 'Band Chest Press', 'chest'),
  band('band-row', 'Band Row', 'back'),
  band('band-pull-apart', 'Band Pull-Apart', 'shoulders'),
  band('band-biceps-curl', 'Band Biceps Curl', 'arms'),
  band('pallof-press', 'Pallof Press', 'core'),
];
