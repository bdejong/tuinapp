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

const confirmingDelete = ref(false);

const handleDelete = () => {
  if (!props.plant?.id) return;
  confirmingDelete.value = true;
};

const confirmDelete = () => {
  if (props.plant?.id) {
    emit('delete', props.plant.id);
  }
  confirmingDelete.value = false;
};

const cancelDelete = () => {
  confirmingDelete.value = false;
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
        <div class="button-group">
          <button
            v-for="opt in PLANT_TYPES"
            :key="opt.value"
            type="button"
            :class="{ selected: form.plant_type === opt.value }"
            :title="opt.label"
            @click="form.plant_type = form.plant_type === opt.value ? undefined : opt.value"
          >
            <span class="icon">{{ opt.icon }}</span>
            <span class="label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label>Sun Requirement</label>
        <div class="button-group">
          <button
            v-for="opt in SUN_REQUIREMENTS"
            :key="opt.value"
            type="button"
            :class="{ selected: form.sun_requirement === opt.value }"
            :title="opt.label"
            @click="form.sun_requirement = form.sun_requirement === opt.value ? undefined : opt.value"
          >
            <span class="icon">{{ opt.icon }}</span>
            <span class="label">{{ opt.label }}</span>
          </button>
        </div>
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
        <template v-if="isEditing()">
          <template v-if="confirmingDelete">
            <span class="confirm-text">Delete this plant?</span>
            <button type="button" class="delete-btn" @click="confirmDelete">Yes, Delete</button>
            <button type="button" class="secondary-btn" @click="cancelDelete">No</button>
          </template>
          <button v-else type="button" class="delete-btn" @click="handleDelete">Delete</button>
        </template>
        <div class="spacer"></div>
        <button type="button" class="secondary-btn" @click="emit('close')">Cancel</button>
        <button v-if="!isEditing()" type="button" class="secondary-btn" @click="handleSaveAndAdd">Save & Add Another</button>
        <button type="button" class="primary-btn" @click="handleSave">{{ isEditing() ? 'Save' : 'Save & Close' }}</button>
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
  padding: 1.25rem;
  border-radius: 8px;
  max-width: 550px;
  max-height: 90vh;
  overflow-y: auto;
  width: 100%;
  font-size: 0.85rem;
}

.modal h2 {
  font-size: 1.1rem;
  margin-bottom: 1rem;
}

.form-group {
  margin-bottom: 0.75rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.2rem;
  font-weight: 500;
  font-size: 0.8rem;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.85rem;
}

.button-row {
  display: flex;
  gap: 0.4rem;
  margin-top: 1rem;
  flex-wrap: wrap;
  align-items: center;
}

.spacer {
  flex: 1;
}

button {
  padding: 0.35rem 0.75rem;
  border: none;
  border-radius: 4px;
  font-size: 0.8rem;
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

.confirm-text {
  color: #f44336;
  font-weight: 500;
  margin-right: 0.5rem;
}

.button-group {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.button-group button {
  padding: 0.3rem 0.6rem;
  border: 1px solid #ccc;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 0.8rem;
}

.button-group button:hover {
  border-color: #4caf50;
}

.button-group button.selected {
  background: #4caf50;
  color: white;
  border-color: #4caf50;
}

.button-group button .icon {
  font-size: 1rem;
  margin-right: 0.2rem;
}

.button-group button .label {
  font-size: 0.75rem;
}
</style>
