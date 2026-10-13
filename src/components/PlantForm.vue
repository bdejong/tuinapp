<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDialog } from '../composables/useDialog';
import type { Plant } from '../types';
import { SUN_REQUIREMENTS, PLANT_TYPES, SUN_BITS } from '../types';
import PeriodCheckboxGrid from './PeriodCheckboxGrid.vue';
import SunIcon from './SunIcon.vue';

const props = defineProps<{
  plant?: Plant;
  visible: boolean;
  busy?: boolean;
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
  sun_requirements: 0,
  sow_periods: 0,
  plant_periods: 0,
  notes: '',
  needs_reorder: false,
});

const initial = ref('');
const validationError = ref('');
watch(() => props.visible, (visible) => {
  validationError.value = '';
  if (visible && props.plant) {
    form.value = { ...props.plant };
  } else if (visible) {
    form.value = {
      name: '',
      plant_type: undefined,
      sun_requirements: 0,
      sow_periods: 0,
      plant_periods: 0,
      notes: '',
      needs_reorder: false,
    };
  }
  if (visible) initial.value = JSON.stringify(form.value);
}, { immediate: true });

// Map SUN_REQUIREMENTS values to bit values
const sunBitMap: Record<string, number> = {
  'full_sun': SUN_BITS.FULL_SUN,
  'partial_shade': SUN_BITS.PARTIAL_SHADE,
  'full_shade': SUN_BITS.FULL_SHADE,
};

const hasSunBit = (value: string) => {
  const bit = sunBitMap[value] || 0;
  return (form.value.sun_requirements & bit) !== 0;
};

const toggleSunBit = (value: string) => {
  const bit = sunBitMap[value] || 0;
  form.value.sun_requirements ^= bit;
};

const isEditing = () => props.plant?.id !== undefined;

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

const confirmingDelete = ref(false);
watch(() => props.visible, () => { confirmingDelete.value = false; });

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
  <div v-if="visible" class="modal-overlay" @click.self="requestClose">
    <form ref="dialog" class="modal" @submit.prevent="handleSave" role="dialog" aria-modal="true" aria-label="Plant details">
      <h2>{{ isEditing() ? 'Edit Plant' : 'Add Plant' }}</h2>

      <div class="form-group">
        <label for="PlantForm-name">Name</label>
        <input :aria-invalid="!!validationError" :aria-describedby="validationError ? 'PlantForm-error' : undefined" id="PlantForm-name" v-model="form.name" maxlength="500" type="text" placeholder="Plant name" />
      </div>

      <div class="form-group">
        <label>Type</label>
        <div class="button-group">
          <button type="button"
            v-for="opt in PLANT_TYPES"
            :key="opt.value"
            :aria-pressed="form.plant_type === opt.value"
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
        <label>Sun Requirements</label>
        <div class="button-group">
          <button type="button"
            v-for="opt in SUN_REQUIREMENTS"
            :key="opt.value"
            :aria-pressed="hasSunBit(opt.value)"
            :class="{ selected: hasSunBit(opt.value) }"
            :title="opt.label"
            @click="toggleSunBit(opt.value)"
          >
            <SunIcon :value="opt.value" decorative class="sun-choice-icon" />
            <span class="label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <PeriodCheckboxGrid v-model="form.sow_periods" label="Sowing Periods" />
      <PeriodCheckboxGrid v-model="form.plant_periods" label="Planting Periods" />

      <div class="form-group">
        <label for="PlantForm-notes">Notes</label>
        <textarea id="PlantForm-notes" v-model="form.notes" rows="3" placeholder="Optional notes"></textarea>
      </div>

      <div class="form-group checkbox-row">
        <label class="checkbox-label">
          <input type="checkbox" v-model="form.needs_reorder" />
          Needs to be reordered
        </label>
      </div>

      <p v-if="validationError" id="PlantForm-error" class="validation-error" role="alert">{{ validationError }}</p>
      <div class="button-row">
        <template v-if="isEditing()">
          <template v-if="confirmingDelete">
            <span class="confirm-text">Delete this plant?</span>
            <button type="button" class="delete-btn" :disabled="busy" @click="confirmDelete">Yes, Delete</button>
            <button type="button" class="secondary-btn" @click="cancelDelete">No</button>
          </template>
          <button type="button" v-else  class="delete-btn" @click="handleDelete">Delete</button>
        </template>
        <div class="spacer"></div>
        <button type="button" class="secondary-btn" :disabled="busy" @click="requestClose">Cancel</button>
        <button type="button" v-if="!isEditing()"  class="secondary-btn" :disabled="busy" @click="handleSaveAndAdd">Save & Add Another</button>
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
  background: #386145;
  color: white;
}

.secondary-btn {
  background: #e0e0e0;
}

.delete-btn {
  background: #b83227;
  color: white;
}

.confirm-text {
  color: #b83227;
  font-weight: 500;
  margin-right: 0.5rem;
}

.checkbox-row {
  margin-top: 0.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: normal;
}

.checkbox-label input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
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
  border-color: #386145;
}

.button-group button.selected {
  background: #386145;
  color: white;
  border-color: #386145;
}

.button-group button .icon {
  font-size: 1rem;
  margin-right: 0.2rem;
}

.sun-choice-icon {margin-right:5px;background:white;border-radius:3px;padding:1px;}

.button-group button .label {
  font-size: 0.75rem;
}
@media (max-width: 700px) {
  .modal-overlay { align-items: center; padding: 8px; }
  .modal { width: 100%; max-width: 550px; max-height: calc(100dvh - 16px); padding: 16px; border-radius: 12px; }
  .form-group input, .form-group select, .form-group textarea { min-height: 44px; font-size: 16px; }
  .form-group textarea { min-height: 80px; }
  .button-group { gap: 6px; }
  .button-group button { min-height: 44px; padding: 7px 9px; }
  .button-row { gap: 8px; }
  .button-row button { min-height: 44px; padding: 8px 10px; }
  .button-row .spacer { display: none; }
  .confirm-text { flex: 1 1 100%; }
  .period-grid { overflow-x: auto; padding-bottom: 4px; }
  :deep(.period-grid .grid) { width: max-content; min-width: 100%; }
  :deep(.period-grid .header-row), :deep(.period-grid .period-row) { grid-template-columns: 42px repeat(12, 40px); }
  :deep(.period-grid .month-header) { padding: 5px 2px; }
  :deep(.period-grid .cell) { min-height: 42px; }
}
</style>

<style scoped>.validation-error {color:#a33229;margin:12px 0;font-size:13px;}.modal {box-shadow:0 18px 60px #0003;}input[aria-invalid="true"] {border-color:#a33229;}</style>
