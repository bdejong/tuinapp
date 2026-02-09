<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Activity } from '../types';
import { getAllActivities, createActivity, updateActivity, deleteActivity } from '../api';
import ActivityForm from './ActivityForm.vue';

const activities = ref<Activity[]>([]);
const showForm = ref(false);
const editingActivity = ref<Activity | undefined>();

const loadActivities = async () => {
  activities.value = await getAllActivities();
};

onMounted(loadActivities);

const openAddForm = () => {
  editingActivity.value = undefined;
  showForm.value = true;
};

const openEditForm = (activity: Activity) => {
  editingActivity.value = activity;
  showForm.value = true;
};

const handleSave = async (activity: Activity) => {
  if (activity.id) {
    await updateActivity(activity);
  } else {
    await createActivity(activity);
  }
  await loadActivities();
  showForm.value = false;
};

const handleSaveAndAdd = async (activity: Activity) => {
  await createActivity(activity);
  await loadActivities();
  editingActivity.value = undefined;
};

const handleDelete = async (id: number) => {
  await deleteActivity(id);
  await loadActivities();
  showForm.value = false;
};

defineExpose({ openAddForm });
</script>

<template>
  <div class="activity-list">
    <div class="header">
      <h1>Activities</h1>
      <button class="add-btn" @click="openAddForm">+ Add Activity</button>
    </div>

    <table v-if="activities.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="activity in activities" :key="activity.id" @click="openEditForm(activity)">
          <td>{{ activity.name }}</td>
          <td>{{ activity.description || '-' }}</td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No activities yet. Add your first activity!</p>

    <ActivityForm
      :visible="showForm"
      :activity="editingActivity"
      @save="handleSave"
      @save-and-add="handleSaveAndAdd"
      @delete="handleDelete"
      @close="showForm = false"
    />
  </div>
</template>

<style scoped>
.activity-list { padding: 1rem; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.add-btn { background: #4caf50; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #eee; }
th { background: #f5f5f5; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #f9f9f9; }
.empty { color: #666; text-align: center; padding: 2rem; }
</style>
