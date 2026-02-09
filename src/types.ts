export interface Plant {
  id?: number;
  name: string;
  plant_type?: 'vegetable_fruit' | 'flower' | 'herb';
  sun_requirement?: 'full_sun' | 'partial_shade' | 'full_shade';
  sow_periods: number;
  plant_periods: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PlantPhoto {
  id?: number;
  plant_id: number;
  sort_order: number;
  image_data?: string;
  created_at?: string;
}

export interface Activity {
  id?: number;
  name: string;
  description?: string;
  active_periods: number;
  created_at?: string;
  updated_at?: string;
}

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

export const PLANT_TYPES = [
  { value: 'vegetable_fruit', label: 'Vegetable/Fruit', icon: '🥕' },
  { value: 'flower', label: 'Flower', icon: '🌸' },
  { value: 'herb', label: 'Herb', icon: '🌿' },
] as const;

export const SUN_REQUIREMENTS = [
  { value: 'full_sun', label: 'Full Sun', icon: '☀️' },
  { value: 'partial_shade', label: 'Partial Shade', icon: '⛅' },
  { value: 'full_shade', label: 'Full Shade', icon: '🌑' },
] as const;
