<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Activity } from '../types';
import PeriodCheckboxGrid from './PeriodCheckboxGrid.vue';

const props = defineProps<{
  activity?: Activity;
  visible: boolean;
}>();

const emit = defineEmits<{
  save: [activity: Activity];
  'save-and-add': [activity: Activity];
  delete: [id: number];
  close: [];
}>();

const form = ref<Activity>({
  name: '',
  description: '',
  active_periods: 0,
});

watch(() => props.visible, (visible) => {
  if (visible && props.activity) {
    form.value = { ...props.activity };
  } else if (visible) {
    form.value = {
      name: '',
      description: '',
      active_periods: 0,
    };
  }
}, { immediate: true });

const isEditing = () => props.activity?.id !== undefined;

const handleSave = () => emit('save', { ...form.value });
const handleSaveAndAdd = () => emit('save-and-add', { ...form.value });

const handleDelete = () => {
  if (props.activity?.id && confirm('Delete this activity?')) {
    emit('delete', props.activity.id);
  }
};
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <h2>{{ isEditing() ? 'Edit Activity' : 'Add Activity' }}</h2>

      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="Activity name" />
      </div>

      <div class="form-group">
        <label>Description</label>
        <textarea v-model="form.description" rows="3" placeholder="Activity description"></textarea>
      </div>

      <PeriodCheckboxGrid v-model="form.active_periods" label="Active Periods" />

      <div class="button-row">
        <button v-if="isEditing()" class="delete-btn" @click="handleDelete">Delete</button>
        <div class="spacer"></div>
        <button class="secondary-btn" @click="emit('close')">Cancel</button>
        <button v-if="!isEditing()" class="secondary-btn" @click="handleSaveAndAdd">Save & Add Another</button>
        <button class="primary-btn" @click="handleSave">{{ isEditing() ? 'Save' : 'Save & Close' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  width: 100%;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.button-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.spacer { flex: 1; }

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.primary-btn { background: #4caf50; color: white; }
.secondary-btn { background: #e0e0e0; }
.delete-btn { background: #f44336; color: white; }
</style>
