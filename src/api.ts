import type { Plant, Activity } from './types';
let csrfToken = '';
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(path: string, method = 'GET', body?: unknown, quiet = false, binary = false, reportError = method !== 'GET' || binary): Promise<T> {
  try {
    const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Tuinapp-Request': '1', 'X-CSRF-Token': csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && path !== '/login' && !quiet) window.dispatchEvent(new Event('session-expired'));
      throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
    }
    if ((method !== 'GET' || binary) && !quiet) window.dispatchEvent(new CustomEvent('api-error', { detail: '' }));
    if (binary) return await response.blob() as T;
    return response.status === 204 ? undefined as T : await response.json();
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Connection failed. Please try again.');
    // Reads show their error beside the retry control; authentication failures open sign-in.
    if (!quiet && reportError && !(error instanceof ApiError && error.status === 401)) window.dispatchEvent(new CustomEvent('api-error', { detail: error.message }));
    throw error;
  }
}
export const login = async (password: string) => { csrfToken = (await request<{csrf_token: string}>('/login', 'POST', { password }, true)).csrf_token; };
export const checkSession = async () => { csrfToken = (await request<{csrf_token: string}>('/session', 'GET', undefined, true)).csrf_token; };
export const logout = async () => { await request('/session', 'DELETE'); csrfToken = ''; };
export const getAllPlants = () => request<Plant[]>('/plants');
export const createPlant = (plant: Plant) => request<Plant>('/plants', 'POST', plant);
export const updatePlant = (plant: Plant) => request<Plant>(`/plants/${plant.id}`, 'PUT', plant);
export const deletePlant = (id: number, revision?: number) => request<void>(`/plants/${id}`, 'DELETE', { revision });
export const getPlantsToReorder = async () => (await getAllPlants()).filter(p => p.needs_reorder);
export const markOrdered = (plant: Plant) => request<Plant>(`/plants/${plant.id}/reorder`, 'PUT', { needs_reorder: false, revision: plant.revision });
export const getAllActivities = () => request<Activity[]>('/activities');
export const createActivity = (activity: Activity) => request<Activity>('/activities', 'POST', activity);
export const updateActivity = (activity: Activity) => request<Activity>(`/activities/${activity.id}`, 'PUT', activity);
export const deleteActivity = (id: number, revision?: number) => request<void>(`/activities/${id}`, 'DELETE', { revision });
export interface MonthData { sow_early: Plant[]; sow_late: Plant[]; plant_early: Plant[]; plant_late: Plant[]; activities: Activity[]; }
export const getMonthData = (month: number) => request<MonthData>(`/months/${month}`);
export const getMonthPdf = (month: number) => request<Blob>(`/months/${month}/pdf`, 'GET', undefined, false, true, false);
export interface BackupStatus { latest: { created_at: string; reason: string; plants: number; activities: number; sha256: string } | null; last_error: string | null; last_restore_verified_at: string | null; storage: string; }
export const getBackupStatus = () => request<BackupStatus>('/backups/status');
export const createBackup = () => request<BackupStatus>('/backups', 'POST');
export const verifyBackup = () => request<BackupStatus>('/backups/verify', 'POST');
export const downloadBackup = () => request<Blob>('/backups/download', 'GET', undefined, false, true);
