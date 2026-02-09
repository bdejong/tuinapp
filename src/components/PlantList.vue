<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Plant } from '../types';
import { PLANT_TYPES, SUN_REQUIREMENTS } from '../types';
import { getAllPlants, createPlant, updatePlant, deletePlant } from '../api';
import PlantForm from './PlantForm.vue';

const getTypeIcon = (type: string | undefined): string => {
  const found = PLANT_TYPES.find(t => t.value === type);
  return found?.icon || '-';
};

const getSunIcon = (sun: string | undefined): string => {
  const found = SUN_REQUIREMENTS.find(s => s.value === sun);
  return found?.icon || '-';
};

const plants = ref<Plant[]>([]);
const showForm = ref(false);
const editingPlant = ref<Plant | undefined>();

const loadPlants = async () => {
  plants.value = await getAllPlants();
};

onMounted(loadPlants);

const openAddForm = () => {
  editingPlant.value = undefined;
  showForm.value = true;
};

const openEditForm = (plant: Plant) => {
  editingPlant.value = plant;
  showForm.value = true;
};

const handleSave = async (plant: Plant) => {
  if (plant.id) {
    await updatePlant(plant);
  } else {
    await createPlant(plant);
  }
  await loadPlants();
  showForm.value = false;
};

const handleSaveAndAdd = async (plant: Plant) => {
  await createPlant(plant);
  await loadPlants();
  editingPlant.value = undefined;
};

const handleDelete = async (id: number) => {
  await deletePlant(id);
  await loadPlants();
  showForm.value = false;
};

const truncateNotes = (notes: string | undefined, maxLength = 50): string => {
  if (!notes) return '-';
  if (notes.length <= maxLength) return notes;
  return notes.substring(0, maxLength) + '...';
};

defineExpose({ openAddForm, openEditForm });
</script>

<template>
  <div class="plant-list">
    <div class="header">
      <h1>Plants</h1>
      <button class="add-btn" @click="openAddForm">+ Add Plant</button>
    </div>

    <table v-if="plants.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th class="icon-header">Type</th>
          <th class="icon-header">Sun</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plant in plants" :key="plant.id" @click="openEditForm(plant)">
          <td>{{ plant.name }}</td>
          <td class="icon-cell" :title="plant.plant_type?.replace('_', '/')">{{ getTypeIcon(plant.plant_type) }}</td>
          <td class="icon-cell" :title="plant.sun_requirement?.replace('_', ' ')">{{ getSunIcon(plant.sun_requirement) }}</td>
          <td :title="plant.notes">{{ truncateNotes(plant.notes) }}</td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No plants yet. Add your first plant!</p>

    <PlantForm
      :visible="showForm"
      :plant="editingPlant"
      @save="handleSave"
      @save-and-add="handleSaveAndAdd"
      @delete="handleDelete"
      @close="showForm = false"
    />
  </div>
</template>

<style scoped>
.plant-list {
  padding: 0.75rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.header h1 {
  font-size: 1.25rem;
  margin: 0;
}

.add-btn {
  background: #4caf50;
  color: white;
  border: none;
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid #eee;
  font-size: 0.8rem;
}

th {
  background: #f5f5f5;
  font-size: 0.75rem;
  font-weight: 600;
}

.icon-header {
  text-align: center;
  width: 50px;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover {
  background: #f9f9f9;
}

.empty {
  color: #666;
  text-align: center;
  padding: 1.5rem;
  font-size: 0.85rem;
}

.icon-cell {
  text-align: center;
  font-size: 1rem;
}
</style>
