<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDialog } from '../composables/useDialog';
import type { Activity } from '../types';
import PeriodCheckboxGrid from './PeriodCheckboxGrid.vue';

const props = defineProps<{
  activity?: Activity;
  visible: boolean;
  busy?: boolean;
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

const initial = ref('');
const validationError = ref('');
watch(() => props.visible, (visible) => {
  validationError.value = '';
  if (visible && props.activity) {
    form.value = { ...props.activity };
  } else if (visible) {
    form.value = {
      name: '',
      description: '',
      active_periods: 0,
    };
  }
  if (visible) initial.value = JSON.stringify(form.value);
}, { immediate: true });

const isEditing = () => props.activity?.id !== undefined;

const requestClose = () => {
  if (props.busy) return;
  if (JSON.stringify(form.value) !== initial.value && !window.confirm('Discard your unsaved changes?')) return;
  emit('close');
};
const dialog = useDialog(() => props.visible, requestClose);
const valid = () => {
  if (props.busy) return false;
  if (!form.value.name.trim()) { validationError.value = 'Please enter a name.'; return false; }
  validationError.value = ''; return true;
};
const handleSave = () => { if (valid()) emit('save', { ...form.value }); };
const handleSaveAndAdd = () => { if (valid()) emit('save-and-add', { ...form.value }); };

const handleDelete = () => {
  if (props.activity?.id && confirm('Delete this activity?')) {
    emit('delete', props.activity.id);
  }
};
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="requestClose">
    <form ref="dialog" class="modal" @submit.prevent="handleSave" role="dialog" aria-modal="true" aria-label="Activity details">
      <h2>{{ isEditing() ? 'Edit Activity' : 'Add Activity' }}</h2>

      <div class="form-group">
        <label for="ActivityForm-name">Name</label>
        <input :aria-invalid="!!validationError" :aria-describedby="validationError ? 'ActivityForm-error' : undefined" id="ActivityForm-name" v-model="form.name" maxlength="500" type="text" placeholder="Activity name" />
      </div>

      <div class="form-group">
        <label for="ActivityForm-description">Description</label>
        <textarea id="ActivityForm-description" v-model="form.description" rows="3" placeholder="Activity description"></textarea>
      </div>

      <PeriodCheckboxGrid v-model="form.active_periods" label="Active Periods" />

      <p v-if="validationError" id="ActivityForm-error" class="validation-error" role="alert">{{ validationError }}</p>
      <div class="button-row">
        <button type="button" v-if="isEditing()" class="delete-btn" :disabled="busy" @click="handleDelete">Delete</button>
        <div class="spacer"></div>
        <button type="button" class="secondary-btn" :disabled="busy" @click="requestClose">Cancel</button>
        <button type="button" v-if="!isEditing()" class="secondary-btn" :disabled="busy" @click="handleSaveAndAdd">Save & Add Another</button>
        <button type="submit" class="primary-btn" :disabled="busy">{{ isEditing() ? 'Save' : 'Save & Close' }}</button>
      </div>
    </form>
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

.primary-btn { background: #386145; color: white; }
.secondary-btn { background: #e0e0e0; }
.delete-btn { background: #b83227; color: white; }
</style>

<style scoped>.validation-error {color:#a33229;margin:12px 0;font-size:13px;}.modal {box-shadow:0 18px 60px #0003;}input[aria-invalid="true"] {border-color:#a33229;}</style>
