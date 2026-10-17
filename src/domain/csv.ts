import { e1rm, formatWeight } from './metrics';
import type { Kind, Unit } from './types';

export interface CsvRow {
  completedAt: number;
  gym: string;
  exercise: string;
  category: string;
  machine: string;
  setNo: number;
  weight: number;
  reps: number;
  unit: Unit;
  baseWeight: number | null;
  kind?: Kind;
  assisted?: boolean;
}

export const CSV_HEADER = 'date,time,gym,exercise,category,machine,set,weight,reps,unit,base_weight,e1rm';

const pad = (n: number) => String(n).padStart(2, '0');

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function e1rmCell(r: CsvRow): string {
  if (r.unit === 'level' || r.kind === 'bodyweight' || r.assisted) return '';
  return String(Math.round(e1rm(r.weight, r.reps) * 10) / 10);
}

/** RFC 4180 CSV, CRLF line endings, local date/time, dot decimals. */
export function setsToCsv(rows: CsvRow[]): string {
  const lines = rows.map((r) => {
    const d = new Date(r.completedAt);
    return [
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      field(r.gym),
      field(r.exercise),
      field(r.category),
      field(r.machine),
      String(r.setNo),
      formatWeight(r.weight),
      String(r.reps),
      r.unit,
      r.baseWeight === null ? '' : formatWeight(r.baseWeight),
      e1rmCell(r),
    ].join(',');
  });
  return [CSV_HEADER, ...lines].join('\r\n') + '\r\n';
}
