<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Plant } from '../types';
import { SUN_REQUIREMENTS, PLANT_TYPES } from '../types';
import PeriodCheckboxGrid from './PeriodCheckboxGrid.vue';
import PhotoCapture from './PhotoCapture.vue';

const props = defineProps<{
  plant?: Plant;
  visible: boolean;
}>();

const emit = defineEmits<{
  save: [plant: Plant];
  'save-and-add': [plant: Plant];
  delete: [id: number];
  close: [];
}>();

const form = ref<Plant>({
  name: '',
  plant_type: undefined,
  sun_requirement: undefined,
  sow_periods: 0,
  plant_periods: 0,
  notes: '',
});

watch(() => props.visible, (visible) => {
  if (visible && props.plant) {
    form.value = { ...props.plant };
  } else if (visible) {
    form.value = {
      name: '',
      plant_type: undefined,
      sun_requirement: undefined,
      sow_periods: 0,
      plant_periods: 0,
      notes: '',
    };
  }
}, { immediate: true });

const isEditing = () => props.plant?.id !== undefined;

const handleSave = () => {
  emit('save', { ...form.value });
};

const handleSaveAndAdd = () => {
  emit('save-and-add', { ...form.value });
};

const handleDelete = () => {
  if (props.plant?.id && confirm('Delete this plant?')) {
    emit('delete', props.plant.id);
  }
};
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <h2>{{ isEditing() ? 'Edit Plant' : 'Add Plant' }}</h2>

      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="Plant name" />
      </div>

      <div class="form-group">
        <label>Type</label>
        <select v-model="form.plant_type">
          <option :value="undefined">-- Select --</option>
          <option v-for="opt in PLANT_TYPES" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label>Sun Requirement</label>
        <select v-model="form.sun_requirement">
          <option :value="undefined">-- Select --</option>
          <option v-for="opt in SUN_REQUIREMENTS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <PeriodCheckboxGrid v-model="form.sow_periods" label="Sowing Periods" />
      <PeriodCheckboxGrid v-model="form.plant_periods" label="Planting Periods" />

      <div class="form-group">
        <label>Notes</label>
        <textarea v-model="form.notes" rows="3" placeholder="Optional notes"></textarea>
      </div>

      <div v-if="isEditing()" class="form-group">
        <label>Photos</label>
        <PhotoCapture :plant-id="plant?.id" />
      </div>

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
.form-group select,
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

.spacer {
  flex: 1;
}

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.primary-btn {
  background: #4caf50;
  color: white;
}

.secondary-btn {
  background: #e0e0e0;
}

.delete-btn {
  background: #f44336;
  color: white;
}
</style>
