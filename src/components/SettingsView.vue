<script setup lang="ts">
import { useSessionRestore } from '../composables/useSessionRestore';
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { getBackupStatus, backupDownloadUrl, downloadBackup, restoreBackup, type BackupStatus, type BackupEntry } from '../api';
const status = ref<BackupStatus | null>(null);
const statusError = ref('');
const statusLoading = ref(true);
const downloading = ref<string | null>(null);
const downloadError = ref<{ file: string; message: string } | null>(null);
const restoreFile = ref<File | null>(null);
const restoreConfirmed = ref(false);
const restoring = ref(false);
const restoreError = ref('');
const restoreSuccess = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const maxRestoreBytes = 5 * 1024 * 1024;
const now = ref(Date.now());
let active = true;
let refreshing = false;
const formatDate = (date?: string | null) => date ? new Date(date).toLocaleString() : 'Not yet';
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
const checkInterval = computed(() => {
  const seconds = status.value?.check_interval_seconds ?? 86400;
  if (seconds % 86400 === 0) return seconds / 86400 === 1 ? 'daily' : `every ${seconds / 86400} days`;
  if (seconds % 3600 === 0) return `every ${seconds / 3600} hours`;
  return `every ${Math.max(1, Math.round(seconds / 60))} minutes`;
});
const overdue = computed(() => status.value?.last_checked_at && now.value - new Date(status.value.last_checked_at).getTime() > Math.max(status.value.check_interval_seconds * 2000, 120000));
const refresh = async () => {
  if (refreshing || !active) return;
  refreshing = true;
  try {
    const result = await getBackupStatus();
    if (active) { status.value = result; statusError.value = ''; }
  } catch (error) {
    if (active) statusError.value = error instanceof Error ? error.message : 'Could not load backup history.';
  } finally { refreshing = false; if (active) statusLoading.value = false; }
};
let timer: ReturnType<typeof setInterval>;
onMounted(() => { void refresh(); timer = setInterval(() => { now.value = Date.now(); void refresh(); }, 60000); });
onUnmounted(() => { active = false; clearInterval(timer); });
async function download(backup: BackupEntry) {
  if (downloading.value) return;
  downloading.value = backup.file;
  downloadError.value = null;
  try {
    const blob = await downloadBackup(backup.file);
    if (!active) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = backup.file;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    if (active) downloadError.value = { file: backup.file, message: error instanceof Error ? error.message : 'Could not download this backup. Please try again.' };
  } finally { if (active) downloading.value = null; }
}
function chooseRestoreFile(event: Event) {
  const input = event.target as HTMLInputElement;
  restoreFile.value = input.files?.[0] ?? null;
  restoreConfirmed.value = false;
  restoreError.value = restoreFile.value && restoreFile.value.size > maxRestoreBytes ? 'SQL dump files must be no larger than 5 MiB.' : '';
  restoreSuccess.value = false;
}
async function restore() {
  if (!restoreFile.value || restoreFile.value.size > maxRestoreBytes || !restoreConfirmed.value || restoring.value) return;
  restoring.value = true; restoreError.value = ''; restoreSuccess.value = false;
  try {
    await restoreBackup(restoreFile.value);
    restoreSuccess.value = true;
    restoreFile.value = null; restoreConfirmed.value = false;
    if (fileInput.value) fileInput.value.value = '';
    await refresh();
  } catch (error) {
    restoreError.value = error instanceof Error ? error.message : 'Could not restore this dump. Please try again.';
  } finally { restoring.value = false; }
}
useSessionRestore(() => { void refresh(); });
</script>
<template>
  <div class="settings-view">
    <h1>Settings & backups</h1>
    <p class="intro">Your garden is saved as you work. Backups happen automatically, even when the website is closed.</p>
    <section aria-labelledby="backup-heading">
      <h2 id="backup-heading">Automatic backups</h2>
      <p v-if="statusLoading" role="status">Checking backups…</p>
      <p v-if="statusError" class="error" role="alert">{{ statusError }} <button @click="refresh">Try again</button><span v-if="status"> The list below was last loaded successfully and may be out of date.</span></p>
      <template v-if="status">
        <p>Changes are checked {{ checkInterval }}. A new backup is saved only when your garden changes.</p>
        <dl>
          <dt>Last checked</dt><dd>{{ formatDate(status.last_checked_at) }}<span v-if="status.checked_unchanged && !status.last_error" class="detail">No changes since the last backup</span></dd>
          <dt>Latest successful backup</dt><dd>{{ formatDate(status.latest?.created_at) }}</dd>
          <dt>Last recovery check</dt><dd>{{ formatDate(status.last_restore_verified_at) }}</dd>
        </dl>
        <p v-if="status.last_error" class="error" role="alert">The last backup check failed: {{ status.last_error }}</p>
        <p v-if="overdue" class="error" role="alert">Backup checks are overdue. Please check the server.</p>
        <p class="storage-note">Backups are stored in Cloudflare R2.</p>
        <h3>Saved backups <span class="count">({{ status.backups.length }})</span></h3>
        <p v-if="status.backups.length === 0">No saved backups yet. The first backup will appear here automatically.</p>
        <div v-else class="table-wrap">
          <table>
            <caption class="visually-hidden">Saved garden backups, newest first</caption>
            <thead><tr><th scope="col">Saved</th><th scope="col">Contents</th><th scope="col">Size</th><th scope="col">Download</th></tr></thead>
            <tbody><tr v-for="backup in status.backups" :key="backup.file">
              <td><time :datetime="backup.created_at">{{ formatDate(backup.created_at) }}</time><span class="detail">{{ backup.reason === 'scheduled' ? 'Automatic backup' : backup.reason === 'before-restore' ? 'Before a restore · kept for recovery' : backup.reason === 'before-migration' ? 'Before an update · kept for recovery' : backup.reason }}</span></td>
              <td>{{ backup.plants }} plants · {{ backup.activities }} activities</td>
              <td class="size">{{ formatSize(backup.bytes) }}</td>
              <td><a :href="backupDownloadUrl(backup.file)" :aria-label="`Download backup from ${formatDate(backup.created_at)}`" :aria-disabled="downloading !== null || undefined" @click.prevent="download(backup)">{{ downloading === backup.file ? 'Downloading…' : 'Download SQL dump' }}</a><p v-if="downloadError?.file === backup.file" class="error download-error" role="alert">{{ downloadError.message }}</p></td>
            </tr></tbody>
          </table>
        </div>
        <p v-if="status.backups.length" class="hint">Each download is a SQL dump that can be restored from this page.</p>
      </template>
    </section>
    <section aria-labelledby="restore-heading">
      <h2 id="restore-heading">Restore from a SQL dump</h2>
        <p id="restore-help">Choose a dump you downloaded earlier. Restoring replaces the current plants and activities. Maximum file size: 5 MiB.</p>
      <label class="file-label" for="restore-dump">SQL dump file</label>
      <input id="restore-dump" ref="fileInput" type="file" accept=".sql,application/sql,text/plain" :disabled="restoring" @change="chooseRestoreFile">
      <p v-if="restoreFile" class="detail selected-file">Selected: {{ restoreFile.name }}</p>
      <label class="confirm-label"><input v-model="restoreConfirmed" type="checkbox" :disabled="!restoreFile || restoring"> I understand this replaces my current garden.</label>
      <button class="restore-button" :disabled="!restoreFile || restoreFile.size > maxRestoreBytes || !restoreConfirmed || restoring" @click="restore">{{ restoring ? 'Restoring…' : 'Restore garden' }}</button>
      <p v-if="restoreError" class="error" role="alert">{{ restoreError }}</p>
      <p v-if="restoreSuccess" class="success" role="status">Garden restored. The restored garden is now open.</p>
    </section>
  </div>
</template>
<style scoped>
.settings-view {padding:24px;max-width:1180px;}h1 {font-size:24px;margin-bottom:8px;}.intro {color:#58664f;margin-bottom:24px;}section {background:white;padding:24px;border:1px solid #dce2d5;border-radius:8px;margin-bottom:20px;}h2 {font-size:18px;margin-bottom:14px;}h3 {font-size:16px;margin:24px 0 12px;}p {line-height:1.6;margin-bottom:14px;color:#526047;}dl {display:grid;grid-template-columns:230px 1fr;gap:12px;margin:20px 0;}dt {color:#58694e;}dd {margin:0;font-weight:600;}.detail {display:block;font-size:12px;font-weight:400;color:#526047;margin-top:4px;}button {font-size:13px;padding:8px 12px;border:0;border-radius:5px;background:#386145;color:white;cursor:pointer;}button:disabled {opacity:.55;cursor:not-allowed;}a {color:#285b38;text-decoration:underline;text-underline-offset:3px;white-space:nowrap;}a[aria-disabled=true] {cursor:wait;opacity:.6;}a:focus-visible,button:focus-visible,input:focus-visible {outline:3px solid #386145;outline-offset:4px;}.hint {font-size:12px;margin-top:16px;margin-bottom:0;}.storage-note {background:#f3f5ef;padding:12px;border-radius:4px;}.error {color:#a33229;}.success {color:#285b38;font-weight:600;}.table-wrap {overflow-x:auto;}table {width:100%;border-collapse:collapse;font-size:13px;}th {text-align:left;color:#4c5e42;font-weight:600;background:#f5f7f1;}th,td {padding:13px 12px;border-bottom:1px solid #e4e8df;vertical-align:top;}th:first-child,td:first-child {padding-left:8px;}td.size {white-space:nowrap;}.count {color:#5a6850;font-weight:400;}.download-error {max-width:240px;white-space:normal;margin:8px 0 0;}.file-label,.confirm-label {display:block;margin:16px 0 8px;color:#394833;}.confirm-label input {margin-right:8px;}.restore-button {display:block;margin-top:14px;}.selected-file {margin:8px 0;}.download-error {max-width:240px;white-space:normal;margin:8px 0 0;}.visually-hidden {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
</style>
