import { invoke } from '@tauri-apps/api/core';
import { copyFile } from '@tauri-apps/plugin-fs';
import type { Plant, Activity, PlantPhoto } from './types';

// Plants
export const getAllPlants = () => invoke<Plant[]>('get_all_plants');
export const createPlant = (plant: Plant) => invoke<Plant>('create_plant', { plant });
export const updatePlant = (plant: Plant) => invoke<void>('update_plant', { plant });
export const deletePlant = (id: number) => invoke<void>('delete_plant', { id });
export const getPlantsToReorder = () => invoke<Plant[]>('get_plants_to_reorder');

// Activities
export const getAllActivities = () => invoke<Activity[]>('get_all_activities');
export const createActivity = (activity: Activity) => invoke<Activity>('create_activity', { activity });
export const updateActivity = (activity: Activity) => invoke<void>('update_activity', { activity });
export const deleteActivity = (id: number) => invoke<void>('delete_activity', { id });

// Calendar
export interface MonthData {
  sow_early: Plant[];
  sow_late: Plant[];
  plant_early: Plant[];
  plant_late: Plant[];
  activities: Activity[];
}

export const getMonthData = (month: number) => invoke<MonthData>('get_month_data', { month });

// Photos
export const getPhotos = (plantId: number) => invoke<PlantPhoto[]>('get_photos', { plantId });
export const addPhoto = (plantId: number, imageData: string, sortOrder: number) =>
  invoke<PlantPhoto>('add_photo', { plantId, imageData, sortOrder });
export const deletePhoto = (id: number) => invoke<void>('delete_photo', { id });

// Import
export const importPlantsTsv = (tsvContent: string) =>
  invoke<number>('import_plants_tsv', { tsvContent });

// Database
export const getDatabasePath = () => invoke<string>('get_database_path');

export const moveDatabase = async (newPath: string): Promise<string> => {
  // Get current database path
  const currentPath = await getDatabasePath();

  // Copy using Tauri's fs plugin (respects sandbox permissions from dialog)
  await copyFile(currentPath, newPath);

  // Save the new path to config
  return invoke<string>('save_database_path', { newPath });
};
