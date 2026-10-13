<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import LoginView from './components/LoginView.vue';
import { checkSession, logout } from './api';
import type { Plant } from './types';
import PlantList from './components/PlantList.vue';
import PlantGrid from './components/PlantGrid.vue';
import ActivityList from './components/ActivityList.vue';
import MonthlyView from './components/MonthlyView.vue';
import ToOrderView from './components/ToOrderView.vue';
import SettingsView from './components/SettingsView.vue';

type View = 'plants' | 'activities' | 'calendar' | 'toorder' | 'settings';
type PlantSubView = 'list' | 'grid';

const currentView = ref<View>('plants');
const plantSubView = ref<PlantSubView>('list');
const plantListRef = ref<InstanceType<typeof PlantList> | null>(null);
const activityListRef = ref<InstanceType<typeof ActivityList> | null>(null);

const authenticated = ref(false);
const sessionChecked = ref(false);
const workspaceOpened = ref(false);
const workspaceEpoch = ref(0);
const errorMessage = ref('');
const restoredMessage = ref('');
const signedIn = async () => {
  const restoring = workspaceOpened.value;
  authenticated.value = true; workspaceOpened.value = true; errorMessage.value = '';
  await nextTick();
  if (restoring) window.dispatchEvent(new Event('session-restored'));
};
const sessionExpired = () => { authenticated.value = false; };
const gardenRestored = () => {
  // A restore may reuse ids and revisions from an old draft. Remount every view
  // so no open form can be resubmitted against the restored garden.
  currentView.value = 'plants'; plantSubView.value = 'list';
  restoredMessage.value = 'Garden restored. The garden was reloaded and any open drafts were closed.';
  workspaceEpoch.value++;
};
const showError = (event: Event) => { errorMessage.value = (event as CustomEvent<string>).detail; };
const signOut = async () => { try { await logout(); authenticated.value = false; workspaceOpened.value = false; } catch {} };
const handleAddPlant = async () => {
  currentView.value = 'plants'; plantSubView.value = 'list';
  await nextTick(); plantListRef.value?.openAddForm();
};
const handleEditPlant = async (plant: Plant) => {
  plantSubView.value = 'list'; await nextTick(); plantListRef.value?.openEditForm(plant);
};
const handleAddActivity = async () => {
  currentView.value = 'activities'; await nextTick(); activityListRef.value?.openAddForm();
};

const handleKeydown = (e: KeyboardEvent) => {
  if (document.querySelector('[role=dialog]')) return;
  if (authenticated.value && (e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    if (currentView.value === 'activities') {
      handleAddActivity();
    } else {
      handleAddPlant();
    }
  }
};

onMounted(async () => {
  window.addEventListener('api-error', showError);
  window.addEventListener('session-expired', sessionExpired);
  window.addEventListener('garden-restored', gardenRestored);
  try { await checkSession(); signedIn(); } catch {}
  sessionChecked.value = true;
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('api-error', showError);
  window.removeEventListener('session-expired', sessionExpired);
  window.removeEventListener('garden-restored', gardenRestored);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <p v-if="!sessionChecked" class="loading-session">Opening your garden…</p>
  <LoginView v-else-if="!authenticated" @signed-in="signedIn" />
  <div v-if="workspaceOpened" v-show="authenticated" :key="workspaceEpoch" class="app">
    <div v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}<button @click="errorMessage = ''" aria-label="Dismiss error">×</button></div>
    <div v-if="restoredMessage" class="restore-banner" role="status">{{ restoredMessage }}<button @click="restoredMessage = ''" aria-label="Dismiss restore notice">×</button></div>
    <nav class="sidebar">
      <h2>TuinApp</h2><p class="garden-label">GARDEN PLANNER</p>
      <ul>
        <li v-for="view in [{id:'plants',label:'Plants'},{id:'activities',label:'Activities'},{id:'calendar',label:'Calendar'},{id:'toorder',label:'To Order'},{id:'settings',label:'Settings'}]" :key="view.id">
          <button :aria-current="currentView === view.id ? 'page' : undefined" :class="{active:currentView===view.id}" @click="currentView = view.id as View">{{ view.label }}</button>
        </li>
      </ul>
      <button class="sign-out" @click="signOut">Sign out</button>
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
        <PlantGrid v-else @edit="handleEditPlant" />
      </div>
      <ActivityList v-else-if="currentView === 'activities'" ref="activityListRef" />
      <MonthlyView v-else-if="currentView === 'calendar'" />
      <ToOrderView v-else-if="currentView === 'toorder'" />
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
  font-size: 14px;
  color: #2e3929;
  min-width: 900px;
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
    height: auto !important;
  }
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 190px;
  flex-shrink: 0;
  background: #293f2c;
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
  background: #386145;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: #f6f7f2;
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
  background: #386145;
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

<style>
button, input, select, textarea { font: inherit; }
button:disabled { opacity: .55; cursor: wait; }
button:focus-visible, input:focus-visible, select:focus-visible, [tabindex]:focus-visible { outline: 2px solid #7c9e61; outline-offset: 3px; }
.error-banner { position: fixed; top: 16px; left: 220px; right: 28px; background: #fff1eb; color: #963c2e; border: 1px solid #e2b3a5; padding: 16px; z-index: 4000; border-radius: 6px; box-shadow: 0 4px 20px #0001; }
.error-banner button { float: right; border: 0; background: transparent; cursor: pointer; margin-left: 18px; }
.garden-label { font-size: 9px; letter-spacing: .15em; opacity: .65; margin: -5px 0 28px; }
.sign-out { background: transparent; border: 1px solid #ffffff40; color: white; padding: 7px; margin: 12px 0; border-radius: 4px; cursor: pointer; }
.loading-session { padding: 48px; color: #62745c; }
.restore-banner { display:flex; justify-content:space-between; align-items:center; padding:12px 20px; background:#e9f2df; color:#285b38; border-bottom:1px solid #cbdcbc; }
.restore-banner button { border:0; background:transparent; color:inherit; font-size:20px; cursor:pointer; }
@media print { body { min-width: 0; } .error-banner { display: none; } }
</style>

<style scoped>.sidebar li {padding:0;}.sidebar li button {width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:10px;border-radius:4px;cursor:pointer;}.sidebar li button.active {background:#ffffff20;}.sidebar li:hover {background:transparent;}.sidebar li button:hover {background:#ffffff14;}</style>
