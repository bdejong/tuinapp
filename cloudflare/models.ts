export interface Plant {
  id?: number;
  name: string;
  plant_type?: 'vegetable_fruit' | 'flower' | 'herb' | null;
  sun_requirements: number;
  sow_periods: number;
  plant_periods: number;
  notes?: string | null;
  needs_reorder: boolean;
  revision?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Activity {
  id?: number;
  name: string;
  description?: string | null;
  active_periods: number;
  revision?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MonthData {
  sow_early: Plant[];
  sow_late: Plant[];
  plant_early: Plant[];
  plant_late: Plant[];
  activities: Activity[];
}

export function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= 500;
}

export function validMask(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffff;
}

export function validPlant(value: unknown): value is Plant {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Plant>;
  return validName(p.name)
    && Number.isInteger(p.sun_requirements) && (p.sun_requirements as number) >= 0 && (p.sun_requirements as number) <= 7
    && validMask(p.sow_periods) && validMask(p.plant_periods)
    && (p.plant_type == null || ['vegetable_fruit', 'flower', 'herb'].includes(p.plant_type))
    && (p.notes == null || (typeof p.notes === 'string' && new TextEncoder().encode(p.notes).byteLength <= 100_000))
    && typeof p.needs_reorder === 'boolean';
}

export function validActivity(value: unknown): value is Activity {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<Activity>;
  return validName(a.name) && validMask(a.active_periods)
    && (a.description == null || (typeof a.description === 'string' && new TextEncoder().encode(a.description).byteLength <= 100_000));
}
