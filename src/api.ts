import type { Plant, Activity } from './types';
import { generateMonthPdf } from '../cloudflare/pdf';
let csrfToken = '';
let restoreEpoch: number | null = null;
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
export const login = async (password: string) => {
  if (new TextEncoder().encode(password).byteLength > 1024) throw new Error('Password too long');
  const parameters = await request<{version: number; algorithm: string; salt: string; iterations: number}>('/login-parameters', 'GET', undefined, true);
  if (parameters.version !== 1 || parameters.algorithm !== 'PBKDF2-SHA-256' || !Number.isInteger(parameters.iterations) || parameters.iterations < 100_000 || parameters.iterations > 1_000_000) throw new Error('Sign-in is not configured correctly.');
  const saltBytes = Uint8Array.from(atob(parameters.salt.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - parameters.salt.length % 4) % 4)), (char) => char.charCodeAt(0));
  if (saltBytes.byteLength !== 16) throw new Error('Sign-in is not configured correctly.');
  const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: parameters.iterations }, passwordKey, 256));
  let binary = ''; for (const byte of derived) binary += String.fromCharCode(byte);
  const proof = btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  const session = await request<{csrf_token: string; restore_epoch: number}>('/login', 'POST', { proof }, true);
  csrfToken = session.csrf_token;
  updateRestoreEpoch(session.restore_epoch);
};
function updateRestoreEpoch(epoch: number) {
  const changed = restoreEpoch !== null && restoreEpoch !== epoch;
  restoreEpoch = epoch;
  if (changed) window.dispatchEvent(new CustomEvent('garden-restored'));
}
export const checkSession = async () => {
  const session = await request<{csrf_token: string; restore_epoch: number}>('/session', 'GET', undefined, true);
  csrfToken = session.csrf_token; updateRestoreEpoch(session.restore_epoch);
};
export const logout = async () => { await request('/session', 'DELETE'); csrfToken = ''; restoreEpoch = null; };
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
export const getMonthPdf = async (month: number): Promise<Blob> => {
  const data = await request<MonthData>(`/months/${month}/pdf-data`);
  return new Blob([generateMonthPdf(month, data)], { type: 'application/pdf' });
};
export interface BackupEntry { file: string; created_at: string; reason: string; plants: number; activities: number; bytes: number; uploaded_at: string | null; }
export interface BackupStatus {
  latest: Pick<BackupEntry, 'file' | 'created_at' | 'reason' | 'plants' | 'activities'> | null;
  backups: BackupEntry[];
  last_error: string | null;
  last_checked_at: string | null;
  checked_unchanged: boolean;
  check_interval_seconds: number;
  last_restore_verified_at: string | null;
  storage?: 'r2';
  failed_at?: string | null;
  offsite?: { last_checked_at: string | null; last_success_at: string | null; last_restore_verified_at: string | null; last_error: string | null } | null;
}
export const getBackupStatus = () => request<BackupStatus>('/backups/status');
export const backupDownloadUrl = (filename: string) => `/api/backups/${encodeURIComponent(filename)}/download`;
export const downloadBackup = (filename: string) => request<Blob>(`/backups/${encodeURIComponent(filename)}/download`, 'GET', undefined, false, true, false);
export async function restoreBackup(file: File): Promise<void> {
  try {
    const response = await fetch('/api/backups/restore', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/sql', 'X-Tuinapp-Request': '1', 'X-CSRF-Token': csrfToken, 'X-Tuinapp-Restore-Confirm': 'replace' },
      body: file,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
      throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
    }
    const result = await response.json() as { csrf_token?: string; restore_epoch?: number };
    if (typeof result.csrf_token === 'string') csrfToken = result.csrf_token;
    const epochChanged = typeof result.restore_epoch === 'number' && restoreEpoch !== null && result.restore_epoch !== restoreEpoch;
    if (typeof result.restore_epoch === 'number') updateRestoreEpoch(result.restore_epoch);
    // Restore success always advances the epoch. Keep this notification robust
    // if a reverse proxy strips optional JSON fields in front of the app.
    if (!epochChanged) window.dispatchEvent(new CustomEvent('garden-restored'));
    window.dispatchEvent(new CustomEvent('api-error', { detail: '' }));
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Connection failed. Please try again.');
    if (!(error instanceof ApiError && error.status === 401)) window.dispatchEvent(new CustomEvent('api-error', { detail: error.message }));
    throw error;
  }
}
