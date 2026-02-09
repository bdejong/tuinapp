<script setup lang="ts">
import { ref } from 'vue';
import { importPlantsTsv } from '../api';

const importing = ref(false);
const message = ref('');

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
</script>

<template>
  <div class="settings-view">
    <h1>Settings</h1>

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
}

.section p {
  color: #666;
  margin-bottom: 1rem;
}

.error {
  color: #f44336;
}
</style>
