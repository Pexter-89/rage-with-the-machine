export type Category = 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'fullbody';
export type Kind = 'machine' | 'free' | 'bodyweight';
export type Unit = 'kg' | 'level';
export type Loading =
  | { type: 'stack'; weights: number[]; unit?: Unit } // unit default 'kg'
  | { type: 'plate'; base: number; step: number }
  | { type: 'free'; start: number; step: number; max: number; bigStepFrom?: number; bigStep?: number }
  | { type: 'bodyweight'; step: number; max: number };
export interface CatalogExercise {
  id: string;
  name: string;
  category: Category;
  kind: Kind;
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
  loading: Loading;
  unilateral: boolean;
  assisted: boolean;
}
export interface Settings {
  theme: 'system' | 'dark' | 'light';
  autoCloseMinutes: number;
  lastBackupAt: number | null;
}
