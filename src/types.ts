export interface Plant {
  id?: number;
  name: string;
  plant_type?: 'vegetable_fruit' | 'flower' | 'herb';
  sun_requirements: number;
  sow_periods: number;
  plant_periods: number;
  notes?: string;
  needs_reorder: boolean;
  revision?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

// Sun requirement bitmask values
export const SUN_BITS = {
  FULL_SUN: 1,
  PARTIAL_SHADE: 2,
  FULL_SHADE: 4,
} as const;

export interface Activity {
  id?: number;
  name: string;
  description?: string;
  active_periods: number;
  revision?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const;

export const PLANT_TYPES = [
  { value: 'vegetable_fruit', label: 'Vegetable/Fruit', icon: '🥕' },
  { value: 'flower', label: 'Flower', icon: '🌸' },
  { value: 'herb', label: 'Herb', icon: '🌿' },
] as const;

export const SUN_REQUIREMENTS = [
  { value: 'full_sun', label: 'Full Sun', bit: SUN_BITS.FULL_SUN, icon: '/icons/full-sun.svg' },
  { value: 'partial_shade', label: 'Half Sun', bit: SUN_BITS.PARTIAL_SHADE, icon: '/icons/half-sun.svg' },
  { value: 'full_shade', label: 'Shade', bit: SUN_BITS.FULL_SHADE, icon: '/icons/shade.svg' },
] as const;
