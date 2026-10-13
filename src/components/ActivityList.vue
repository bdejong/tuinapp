<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useLoadState } from '../composables/useLoadState';
import { MONTHS, type Activity } from '../types';
import { getAllActivities, createActivity, updateActivity, deleteActivity } from '../api';
import ActivityForm from './ActivityForm.vue';

const activities = ref<Activity[]>([]);
const currentMonth = ref(new Date().getMonth());
const monthGroups = computed(() => Array.from({ length: 12 }, (_, offset) => {
  const index = (currentMonth.value + offset) % 12;
  const mask = 3 << (index * 2);
  return {
    index,
    name: MONTHS[index],
    activities: activities.value.filter(activity => (activity.active_periods & mask) !== 0),
  };
}));
const unscheduledActivities = computed(() => activities.value.filter(activity => activity.active_periods === 0));
const showForm = ref(false);
const formKey = ref(0);
const saving = ref(false);
const editingActivity = ref<Activity | undefined>();

const { loading, loadError, load } = useLoadState();
const loadActivities = () => load(async () => { activities.value = await getAllActivities(); });

let monthTimer: ReturnType<typeof setTimeout>;
function refreshCurrentMonth() {
  clearTimeout(monthTimer);
  const now = new Date();
  currentMonth.value = now.getMonth();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  monthTimer = setTimeout(refreshCurrentMonth, Math.max(1, nextMidnight.getTime() - now.getTime()));
}
function refreshWhenVisible() {
  if (document.visibilityState === 'visible') refreshCurrentMonth();
}

onMounted(() => {
  refreshCurrentMonth();
  document.addEventListener('visibilitychange', refreshWhenVisible);
  window.addEventListener('focus', refreshCurrentMonth);
  loadActivities().catch(() => {});
});
onUnmounted(() => {
  clearTimeout(monthTimer);
  document.removeEventListener('visibilitychange', refreshWhenVisible);
  window.removeEventListener('focus', refreshCurrentMonth);
});

const openAddForm = () => {
  if (showForm.value) return;
  editingActivity.value = undefined;
  showForm.value = true;
};

const openEditForm = (activity: Activity) => {
  editingActivity.value = activity;
  showForm.value = true;
};

const handleSave = async (activity: Activity) => {
  if (saving.value) return;
  saving.value = true;
  try {
    if (activity.id) await updateActivity(activity); else await createActivity(activity);
    showForm.value = false; await loadActivities();
  } catch {} finally { saving.value = false; }
};
const handleSaveAndAdd = async (activity: Activity) => {
  if (saving.value) return;
  saving.value = true;
  try { await createActivity(activity); editingActivity.value = undefined; formKey.value++; await loadActivities(); }
  catch {} finally { saving.value = false; }
};

const handleDelete = async (id: number) => {
  if (saving.value) return;
  saving.value = true;
  try { await deleteActivity(id, editingActivity.value?.revision); await loadActivities(); showForm.value = false; }
  catch {} finally { saving.value = false; }
};

defineExpose({ openAddForm });
</script>

<template>
  <div class="activity-list">
    <div class="header">
      <h1>Activities</h1>
      <button class="add-btn" @click="openAddForm">+ Add Activity</button>
    </div>

    <p v-if="loading" role="status" class="empty">Loading activities…</p>
    <div v-else-if="loadError" class="load-error" role="alert"><p>{{ loadError }}</p><button @click="loadActivities">Try again</button></div>
    <p v-else-if="activities.length === 0" class="empty">No activities yet. Add your first activity!</p>

    <template v-else>
      <section v-for="group in monthGroups" :key="group.index" class="month-section" :data-month-index="group.index">
        <h2 :class="{ 'current-month': group.index === currentMonth }">
          {{ group.name }}
          <span v-if="group.index === currentMonth" class="current-badge" aria-current="date">Current month</span>
        </h2>
        <table v-if="group.activities.length > 0">
          <thead><tr><th>Activity</th><th>Description</th></tr></thead>
          <tbody>
            <tr v-for="activity in group.activities" :key="activity.id" @click="openEditForm(activity)">
              <td data-label="Activity"><button class="row-name" @click.stop="openEditForm(activity)">{{ activity.name }}</button></td>
              <td data-label="Description">{{ activity.description || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="month-empty">No activities scheduled.</p>
      </section>

      <section v-if="unscheduledActivities.length > 0" class="month-section unscheduled-section" data-unscheduled>
        <h2>Unscheduled</h2>
        <p class="section-description">These activities have no active periods yet.</p>
        <table>
          <thead><tr><th>Activity</th><th>Description</th></tr></thead>
          <tbody>
            <tr v-for="activity in unscheduledActivities" :key="activity.id" @click="openEditForm(activity)">
              <td data-label="Activity"><button class="row-name" @click.stop="openEditForm(activity)">{{ activity.name }}</button></td>
              <td data-label="Description">{{ activity.description || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <ActivityForm
      :key="formKey"
      :busy="saving"
      :visible="showForm"
      :activity="editingActivity"
      @save="handleSave"
      @save-and-add="handleSaveAndAdd"
      @delete="handleDelete"
      @close="showForm = false; loadActivities()"
    />
  </div>
</template>

<style scoped>
.activity-list { padding: 1rem; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.add-btn { background: #386145; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
.month-section { margin: 0 0 1.5rem; }
.month-section h2 { display: flex; align-items: center; gap: 0.6rem; margin: 1.25rem 0 0.5rem; padding-bottom: 0.4rem; border-bottom: 1px solid #e1e6dc; font-size: 1.15rem; }
.month-section h2.current-month { color: #245a36; border-bottom: 2px solid #386145; }
.current-badge { padding: 0.2rem 0.55rem; border-radius: 999px; background: #e5f1e7; color: #245a36; font-size: 0.72rem; font-weight: 650; }
.month-empty, .section-description { margin: 0.45rem 0 0.75rem; color: #687267; font-size: 0.9rem; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #eee; }
th { background: #f5f5f5; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #f9f9f9; }
.empty { color: #666; text-align: center; padding: 2rem; }
@media (max-width: 700px) {
  .activity-list { padding: 16px 12px; }
  .header { gap: 8px; align-items: flex-start; }
  .header h1 { font-size: 1.25rem; }
  .add-btn { min-height: 44px; padding: 8px 10px; white-space: nowrap; }
  table, tbody { display: block; width: 100%; }
  thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  tbody tr { display: block; margin: 0 0 12px; padding: 8px 12px; background: white; border: 1px solid #e1e6dc; border-radius: 8px; }
  th, td { display: block; width: auto; min-width: 0; padding: 6px 0; border-bottom: 0; overflow-wrap: anywhere; }
  td + td { border-top: 1px solid #eef0eb; }
  td::before { content: attr(data-label) ' · '; color: #617052; font-size: 0.75rem; font-weight: 600; }
  td:first-child::before { content: ''; }
  .month-section h2 { font-size: 1.05rem; }
}
</style>

<style scoped>.row-name {border:0;background:transparent;text-align:left;padding:0;color:inherit;cursor:pointer;}.load-error {margin:24px 0;padding:16px;border:1px solid #e6c3b8;background:#fff6f1;}.load-error button {margin-top:10px;padding:7px 12px;}.record-count {font-weight:400;color:#617052;font-size:13px;margin-left:8px;}</style>
