<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Plant } from '../types';
import { PLANT_TYPES } from '../types';
import { getPlantsToReorder, updatePlant } from '../api';

const plants = ref<Plant[]>([]);

const getTypeIcon = (type: string | undefined): string => {
  const found = PLANT_TYPES.find(t => t.value === type);
  return found?.icon || '-';
};

const loadPlants = async () => {
  plants.value = await getPlantsToReorder();
};

const markAsOrdered = async (plant: Plant) => {
  await updatePlant({ ...plant, needs_reorder: false });
  await loadPlants();
};

onMounted(loadPlants);
</script>

<template>
  <div class="to-order-view">
    <div class="header">
      <h1>To Order</h1>
    </div>

    <p class="description">Seeds that need to be reordered for next season.</p>

    <table v-if="plants.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th class="icon-header">Type</th>
          <th class="action-header">Action</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plant in plants" :key="plant.id">
          <td>{{ plant.name }}</td>
          <td class="icon-cell" :title="plant.plant_type?.replace('_', '/')">{{ getTypeIcon(plant.plant_type) }}</td>
          <td class="action-cell">
            <button class="ordered-btn" @click="markAsOrdered(plant)">Ordered</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No seeds need to be reordered.</p>
  </div>
</template>

<style scoped>
.to-order-view {
  padding: 0.75rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.header h1 {
  font-size: 1.25rem;
  margin: 0;
}

.description {
  color: #666;
  font-size: 0.85rem;
  margin-bottom: 1rem;
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

.action-header {
  text-align: center;
  width: 80px;
}

.icon-cell {
  text-align: center;
  font-size: 1rem;
}

.action-cell {
  text-align: center;
}

.ordered-btn {
  padding: 0.25rem 0.5rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
}

.ordered-btn:hover {
  background: #43a047;
}

.empty {
  color: #666;
  text-align: center;
  padding: 1.5rem;
  font-size: 0.85rem;
}
</style>
