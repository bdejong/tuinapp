<script setup lang="ts">
import { useSessionRestore } from '../composables/useSessionRestore';
import { ref, onMounted, onUnmounted } from 'vue';
import { getBackupStatus, createBackup, verifyBackup, downloadBackup, type BackupStatus } from '../api';
const status = ref<BackupStatus | null>(null); const busy = ref(false); const message = ref('');
const formatDate = (date?: string | null) => date ? new Date(date).toLocaleString() : 'Not yet';
const statusError = ref('');
const statusLoading = ref(true);
const refresh = async () => {
  statusError.value = '';
  try { status.value = await getBackupStatus(); }
  catch (error) { statusError.value = error instanceof Error ? error.message : 'Could not load backup status.'; }
  finally { statusLoading.value = false; }
};
let timer: ReturnType<typeof setInterval>;
onMounted(() => { refresh(); timer = setInterval(refresh, 60000); }); onUnmounted(() => clearInterval(timer));
async function backup(verify = false) {
  busy.value = true; message.value = '';
  try { status.value = await (verify ? verifyBackup() : createBackup()); message.value = verify ? 'A backup was restored into a temporary database and verified successfully.' : 'Backup created and verified.'; }
  catch {} finally { busy.value = false; }
}
async function download() {
  busy.value = true; message.value = '';
  try {
    const blob = await downloadBackup();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'tuinapp-backup.zip';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.value = 'Your verified backup download is ready.';
    await refresh();
  } catch {} finally { busy.value = false; }
}
useSessionRestore(() => { void refresh(); });
</script>
<template>
  <div class="settings-view"><h1>Settings & backups</h1><p class="intro">Your garden is saved on the server as you work.</p>
    <p v-if="message" class="success" role="status">{{ message }}</p>
    <section><h2>Automatic backups</h2><p>A verified snapshot is created every hour, even when the website is closed.</p>
      <p v-if="statusLoading" role="status">Checking backups…</p>
      <p v-if="statusError" class="error" role="alert">{{ statusError }} <button @click="refresh">Try again</button></p>
      <dl v-if="status"><dt>Latest successful backup</dt><dd>{{ formatDate(status.latest?.created_at) }}</dd><dt>Last restore test</dt><dd>{{ formatDate(status.last_restore_verified_at) }}</dd><dt v-if="status.latest">Records in latest backup</dt><dd v-if="status.latest">{{ status.latest.plants }} plants · {{ status.latest.activities }} activities</dd></dl>
      <p v-if="status?.last_error" class="error" role="alert">The last backup failed: {{ status.last_error }}</p>
      <p v-if="status?.latest && Date.now() - new Date(status.latest.created_at).getTime() > 7200000" class="error">Backups are overdue. Please check the server.</p>
      <p class="storage-note">Backups are currently stored on this server. Independent, encrypted backup storage will be configured with hosting.</p>
      <div class="actions"><button :disabled="busy" @click="backup()">Back up now</button><button :disabled="busy" @click="backup(true)">Test recovery</button><button :disabled="busy" @click="download">Download backup</button></div>
      <p class="hint">Recovery uses a separate database and never replaces your garden automatically.</p>
    </section>
  </div>
</template>
<style scoped>
.settings-view {padding:24px;max-width:1000px;}h1 {font-size:24px;margin-bottom:8px;}.intro {color:#697263;margin-bottom:24px;}section {background:white;padding:24px;border:1px solid #dce2d5;border-radius:8px;margin-bottom:20px;}h2 {font-size:18px;margin-bottom:14px;}p {line-height:1.6;margin-bottom:14px;color:#616d5b;}dl {display:grid;grid-template-columns:220px 1fr;gap:12px;margin:20px 0;}dt {color:#58694e;}dd {font-weight:600;}.actions {display:flex;gap:10px;align-items:center;}button,.button {display:inline-block;font-size:13px;padding:10px 14px;border:0;border-radius:5px;background:#386145;color:white;cursor:pointer;text-decoration:none;}button:disabled {opacity:.5;cursor:wait;}.hint {font-size:12px;margin-top:12px;}.storage-note {background:#fff5df;padding:12px;border-radius:4px;color:#786127;}.error {color:#a33229;}.success {background:#e8f2e2;padding:14px;border-radius:6px;}
</style>
