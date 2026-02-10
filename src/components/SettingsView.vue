<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { importPlantsTsv, getDatabasePath, moveDatabase } from '../api';
import { save } from '@tauri-apps/plugin-dialog';

const importing = ref(false);
const message = ref('');
const dbPath = ref('');
const dbMessage = ref('');
const moving = ref(false);

onMounted(async () => {
  dbPath.value = await getDatabasePath();
});

const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];
  const content = await file.text();

  importing.value = true;
  message.value = '';

  try {
    const count = await importPlantsTsv(content);
    message.value = `Successfully imported ${count} plants!`;
  } catch (err) {
    message.value = `Error: ${err}`;
  } finally {
    importing.value = false;
    input.value = '';
  }
};

const handleBrowseAndMove = async () => {
  const selected = await save({
    defaultPath: 'tuinapp.db',
    filters: [{ name: 'Database', extensions: ['db'] }],
    title: 'Choose new database location',
  });

  if (!selected) return;

  moving.value = true;
  dbMessage.value = '';

  try {
    const result = await moveDatabase(selected);
    dbMessage.value = result;
    dbPath.value = selected;
  } catch (err) {
    dbMessage.value = `Error: ${err}`;
  } finally {
    moving.value = false;
  }
};
</script>

<template>
  <div class="settings-view">
    <h1>Settings</h1>

    <div class="section">
      <h2>Database Location</h2>
      <p>Current location:</p>
      <code class="path">{{ dbPath }}</code>
      <p>Move database to a new location (e.g., Google Drive folder):</p>
      <button class="browse-btn" @click="handleBrowseAndMove" :disabled="moving">
        {{ moving ? 'Moving...' : 'Browse & Move Database' }}
      </button>
      <p v-if="dbMessage" :class="{ error: dbMessage.startsWith('Error'), success: !dbMessage.startsWith('Error') }">
        {{ dbMessage }}
      </p>
    </div>

    <div class="section">
      <h2>Import Data</h2>
      <p>Import plants from a TSV file (Tab-separated values)</p>
      <input
        type="file"
        accept=".tsv,.txt"
        @change="handleFileSelect"
        :disabled="importing"
      />
      <p v-if="message" :class="{ error: message.startsWith('Error') }">
        {{ message }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 1rem;
}

.section {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.section h2 {
  margin-bottom: 0.5rem;
  font-size: 1rem;
}

.section p {
  color: #666;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}

.path {
  display: block;
  background: #f5f5f5;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  margin-bottom: 1rem;
  word-break: break-all;
}

.browse-btn {
  padding: 0.5rem 1rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.browse-btn:disabled {
  background: #ccc;
}

.error {
  color: #f44336;
}

.success {
  color: #4caf50;
}
</style>
