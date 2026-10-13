import type { Activity, Plant } from './models';
import type { Env } from './types';

interface PlantRow extends Omit<Plant, 'needs_reorder'> { needs_reorder: number | boolean }

export async function getPlants(env: Env): Promise<Plant[]> {
  const { results } = await env.DB.prepare(
    'SELECT id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,needs_reorder,created_at,updated_at,revision FROM plants ORDER BY name,id',
  ).all<PlantRow>();
  return results.map((p) => ({ ...p, needs_reorder: Boolean(p.needs_reorder) }));
}

export async function getActivities(env: Env): Promise<Activity[]> {
  const { results } = await env.DB.prepare(
    'SELECT id,name,description,active_periods,created_at,updated_at,revision FROM activities ORDER BY name,id',
  ).all<Activity>();
  return results;
}

export async function onePlant(env: Env, id: number): Promise<Plant | null> {
  const row = await env.DB.prepare(
    'SELECT id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,needs_reorder,created_at,updated_at,revision FROM plants WHERE id=?',
  ).bind(id).first<PlantRow>();
  return row ? { ...row, needs_reorder: Boolean(row.needs_reorder) } : null;
}

export async function oneActivity(env: Env, id: number): Promise<Activity | null> {
  return env.DB.prepare(
    'SELECT id,name,description,active_periods,created_at,updated_at,revision FROM activities WHERE id=?',
  ).bind(id).first<Activity>();
}
