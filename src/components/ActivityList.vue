<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useLoadState } from '../composables/useLoadState';
import { MONTHS, type Activity } from '../types';
import { getAllActivities, createActivity, updateActivity, deleteActivity } from '../api';
import ActivityForm from './ActivityForm.vue';

const activities = ref<Activity[]>([]);
const activityMonths = (periods: number) => {
  const months = MONTHS.filter((_, index) => (periods & (3 << (index * 2))) !== 0);
  return months.length === 12 ? 'Every month' : months.join(', ') || 'Not scheduled';
};
const showForm = ref(false);
const formKey = ref(0);
const saving = ref(false);
const editingActivity = ref<Activity | undefined>();

const { loading, loadError, load } = useLoadState();
const loadActivities = () => load(async () => { activities.value = await getAllActivities(); });

onMounted(() => loadActivities().catch(() => {}));

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
    <table v-else-if="activities.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th class="months-column">Months</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="activity in activities" :key="activity.id" @click="openEditForm(activity)">
          <td><button class="row-name" @click.stop="openEditForm(activity)">{{ activity.name }}</button></td>
          <td class="activity-months">{{ activityMonths(activity.active_periods) }}</td>
          <td>{{ activity.description || '-' }}</td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No activities yet. Add your first activity!</p>

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
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #eee; }
th { background: #f5f5f5; }
.months-column {width:30%;min-width:200px;}.activity-months {line-height:1.5;}
tbody tr { cursor: pointer; }
tbody tr:hover { background: #f9f9f9; }
.empty { color: #666; text-align: center; padding: 2rem; }
</style>

<style scoped>.row-name {border:0;background:transparent;text-align:left;padding:0;color:inherit;cursor:pointer;}.load-error {margin:24px 0;padding:16px;border:1px solid #e6c3b8;background:#fff6f1;}.load-error button {margin-top:10px;padding:7px 12px;}.record-count {font-weight:400;color:#617052;font-size:13px;margin-left:8px;}</style>
