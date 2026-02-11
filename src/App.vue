<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import PlantList from './components/PlantList.vue';
import PlantGrid from './components/PlantGrid.vue';
import ActivityList from './components/ActivityList.vue';
import MonthlyView from './components/MonthlyView.vue';
import SettingsView from './components/SettingsView.vue';

type View = 'plants' | 'activities' | 'calendar' | 'settings';
type PlantSubView = 'list' | 'grid';

const currentView = ref<View>('plants');
const plantSubView = ref<PlantSubView>('list');
const plantListRef = ref<InstanceType<typeof PlantList> | null>(null);
const activityListRef = ref<InstanceType<typeof ActivityList> | null>(null);

const handleAddPlant = () => {
  if (currentView.value !== 'plants') {
    currentView.value = 'plants';
  }
  setTimeout(() => plantListRef.value?.openAddForm(), 0);
};

const handleAddActivity = () => {
  if (currentView.value !== 'activities') {
    currentView.value = 'activities';
  }
  setTimeout(() => activityListRef.value?.openAddForm(), 0);
};

const handleKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    if (currentView.value === 'activities') {
      handleAddActivity();
    } else {
      handleAddPlant();
    }
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
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
        <button @click="handleAddActivity">+ Add Activity</button>
      </div>
    </nav>

    <main class="content">
      <div v-if="currentView === 'plants'" class="plants-container">
        <div class="tabs">
          <button :class="{ active: plantSubView === 'list' }" @click="plantSubView = 'list'">Manage</button>
          <button :class="{ active: plantSubView === 'grid' }" @click="plantSubView = 'grid'">Overview</button>
        </div>
        <PlantList v-if="plantSubView === 'list'" ref="plantListRef" />
        <PlantGrid v-else @edit="(plant) => { plantSubView = 'list'; plantListRef?.openEditForm(plant); }" />
      </div>
      <ActivityList v-else-if="currentView === 'activities'" ref="activityListRef" />
      <MonthlyView v-else-if="currentView === 'calendar'" />
      <SettingsView v-else-if="currentView === 'settings'" />
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
  font-size: 13px;
}

@media print {
  body {
    font-size: 11pt;
  }

  .sidebar {
    display: none !important;
  }

  .content {
    overflow: visible !important;
    background: white !important;
  }

  .app {
    display: block !important;
  }
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 160px;
  background: #2c3e50;
  color: white;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
}

.sidebar h2 {
  margin-bottom: 1rem;
  font-size: 1.1rem;
}

.sidebar ul {
  list-style: none;
  flex: 1;
}

.sidebar li {
  padding: 0.5rem 0.6rem;
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
  gap: 0.35rem;
}

.quick-add button {
  padding: 0.35rem 0.5rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
}

.content {
  flex: 1;
  overflow-y: auto;
  background: #fafafa;
}

.plants-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  padding: 0.35rem 0.75rem;
  gap: 0.35rem;
  background: white;
  border-bottom: 1px solid #eee;
}

.tabs button {
  padding: 0.3rem 0.75rem;
  border: none;
  background: #e0e0e0;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
}

.tabs button.active {
  background: #4caf50;
  color: white;
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
