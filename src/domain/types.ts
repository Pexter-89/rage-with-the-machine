export type Category = 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'fullbody';
export type Kind = 'machine' | 'free' | 'bodyweight';
/** What the exercise is done with; drives the picker icon. Defaults from `kind` (see `equipmentOf`). */
export type Equipment = 'machine' | 'barbell' | 'dumbbell' | 'kettlebell' | 'band' | 'bodyweight';
export type Unit = 'kg' | 'level';
export type Loading =
  | { type: 'stack'; weights: number[]; unit?: Unit } // unit default 'kg'
  | { type: 'plate'; base: number; step: number }
  // Loaded plate by plate: `base` is the bar or sled, each plate goes on `sides` sides (2 = a pair per tap).
  | { type: 'plates'; base: number; plates: number[]; sides: 1 | 2 }
  | { type: 'free'; start: number; step: number; max: number; bigStepFrom?: number; bigStep?: number }
  | { type: 'bodyweight'; step: number; max: number };
export interface CatalogExercise {
  id: string;
  name: string;
  category: Category;
  kind: Kind;
  equipment?: Equipment;
  unilateral?: boolean;
  assisted?: boolean;
  defaultLoading?: Loading;
  builtIn: boolean;
}
export interface Gym {
  id: string;
  name: string;
  order: number;
  archived: boolean;
}
export interface GymExercise {
  id: string;
  gymId: string;
  catalogId: string;
  label: string;
  notes: string;
  loading: Loading;
  hidden: boolean;
}
export interface Session {
  id: string;
  gymId: string;
  startedAt: number;
  endedAt: number | null;
  lastActivityAt: number;
}
export interface SetEntry {
  id: string;
  sessionId: string;
  gymId: string;
  catalogId: string;
  gymExerciseId: string | null;
  order: number;
  weight: number;
  reps: number;
  baseWeight: number | null;
  unit: Unit;
  completedAt: number;
}
export interface PickerItem {
  key: string;
  catalogId: string;
  gymExerciseId: string | null;
  name: string;
  label: string;
  category: Category;
  equipment: Equipment;
  loading: Loading;
  unilateral: boolean;
  assisted: boolean;
}
export interface Settings {
  theme: 'system' | 'dark' | 'light';
  autoCloseMinutes: number;
  lastBackupAt: number | null;
}
