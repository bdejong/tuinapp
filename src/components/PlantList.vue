<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Plant } from '../types';
import { getAllPlants, createPlant, updatePlant, deletePlant } from '../api';
import PlantForm from './PlantForm.vue';

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
          <th>Sun</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plant in plants" :key="plant.id" @click="openEditForm(plant)">
          <td>{{ plant.name }}</td>
          <td>{{ plant.sun_requirement?.replace('_', ' ') || '-' }}</td>
          <td>{{ plant.notes || '-' }}</td>
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
  padding: 1rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.add-btn {
  background: #4caf50;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  text-align: left;
  padding: 0.75rem;
  border-bottom: 1px solid #eee;
}

th {
  background: #f5f5f5;
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
  padding: 2rem;
}
</style>
