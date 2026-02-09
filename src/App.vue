<script setup lang="ts">
import { ref } from 'vue';
import PlantList from './components/PlantList.vue';

type View = 'plants' | 'activities' | 'calendar' | 'settings';

const currentView = ref<View>('plants');
const plantListRef = ref<InstanceType<typeof PlantList> | null>(null);

const handleAddPlant = () => {
  if (currentView.value !== 'plants') {
    currentView.value = 'plants';
  }
  setTimeout(() => plantListRef.value?.openAddForm(), 0);
};
</script>

<template>
  <div class="app">
    <nav class="sidebar">
      <h2>TuinApp</h2>
      <ul>
        <li :class="{ active: currentView === 'plants' }" @click="currentView = 'plants'">
          Plants
        </li>
        <li :class="{ active: currentView === 'activities' }" @click="currentView = 'activities'">
          Activities
        </li>
        <li :class="{ active: currentView === 'calendar' }" @click="currentView = 'calendar'">
          Calendar
        </li>
        <li :class="{ active: currentView === 'settings' }" @click="currentView = 'settings'">
          Settings
        </li>
      </ul>
      <div class="quick-add">
        <button @click="handleAddPlant">+ Add Plant</button>
        <button>+ Add Activity</button>
      </div>
    </nav>

    <main class="content">
      <PlantList v-if="currentView === 'plants'" ref="plantListRef" />
      <div v-else-if="currentView === 'activities'" class="placeholder">Activities (coming soon)</div>
      <div v-else-if="currentView === 'calendar'" class="placeholder">Calendar (coming soon)</div>
      <div v-else-if="currentView === 'settings'" class="placeholder">Settings (coming soon)</div>
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 200px;
  background: #2c3e50;
  color: white;
  padding: 1rem;
  display: flex;
  flex-direction: column;
}

.sidebar h2 {
  margin-bottom: 1.5rem;
}

.sidebar ul {
  list-style: none;
  flex: 1;
}

.sidebar li {
  padding: 0.75rem;
  cursor: pointer;
  border-radius: 4px;
  margin-bottom: 0.25rem;
}

.sidebar li:hover {
  background: rgba(255, 255, 255, 0.1);
}

.sidebar li.active {
  background: rgba(255, 255, 255, 0.2);
}

.quick-add {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.quick-add button {
  padding: 0.5rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.content {
  flex: 1;
  overflow-y: auto;
  background: #fafafa;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 1.25rem;
}
</style>
