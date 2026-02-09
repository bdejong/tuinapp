<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Plant } from '../types';
import { MONTHS } from '../types';
import { getAllPlants } from '../api';

const plants = ref<Plant[]>([]);

onMounted(async () => {
  plants.value = await getAllPlants();
});

const emit = defineEmits<{
  edit: [plant: Plant];
}>();

const isPeriodActive = (periods: number, monthIndex: number, isLate: boolean): boolean => {
  const bitIndex = monthIndex * 2 + (isLate ? 1 : 0);
  return (periods & (1 << bitIndex)) !== 0;
};
</script>

<template>
  <div class="plant-grid">
    <h1>Plant Overview</h1>

    <div class="grid-container" v-if="plants.length > 0">
      <table>
        <thead>
          <tr>
            <th class="plant-name-header">Plant</th>
            <th v-for="month in MONTHS" :key="month" colspan="2" class="month-header">
              {{ month }}
            </th>
          </tr>
          <tr>
            <th></th>
            <template v-for="month in MONTHS" :key="month + '-sub'">
              <th class="sub-header">E</th>
              <th class="sub-header">L</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plant in plants" :key="plant.id" @click="emit('edit', plant)">
            <td class="plant-name">{{ plant.name }}</td>
            <template v-for="(_, monthIndex) in MONTHS" :key="monthIndex">
              <td
                class="period-cell"
                :class="{
                  'sow': isPeriodActive(plant.sow_periods, monthIndex, false),
                  'plant': isPeriodActive(plant.plant_periods, monthIndex, false),
                  'both': isPeriodActive(plant.sow_periods, monthIndex, false) && isPeriodActive(plant.plant_periods, monthIndex, false),
                }"
              ></td>
              <td
                class="period-cell"
                :class="{
                  'sow': isPeriodActive(plant.sow_periods, monthIndex, true),
                  'plant': isPeriodActive(plant.plant_periods, monthIndex, true),
                  'both': isPeriodActive(plant.sow_periods, monthIndex, true) && isPeriodActive(plant.plant_periods, monthIndex, true),
                }"
              ></td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty">No plants yet. Add plants to see the overview.</p>

    <div class="legend">
      <span class="legend-item"><span class="swatch sow"></span> Sow</span>
      <span class="legend-item"><span class="swatch plant"></span> Plant</span>
      <span class="legend-item"><span class="swatch both"></span> Both</span>
    </div>
  </div>
</template>

<style scoped>
.plant-grid {
  padding: 1rem;
}

.grid-container {
  overflow-x: auto;
  margin: 1rem 0;
}

table {
  border-collapse: collapse;
  font-size: 0.875rem;
}

th, td {
  border: 1px solid #ddd;
  padding: 0.25rem;
  text-align: center;
}

.plant-name-header {
  min-width: 150px;
  text-align: left;
  padding-left: 0.5rem;
}

.month-header {
  background: #f5f5f5;
}

.sub-header {
  font-size: 0.7rem;
  color: #666;
  background: #fafafa;
}

.plant-name {
  text-align: left;
  padding-left: 0.5rem;
  cursor: pointer;
}

.period-cell {
  width: 20px;
  height: 20px;
}

.period-cell.sow {
  background: #81c784;
}

.period-cell.plant {
  background: #ffb74d;
}

.period-cell.both {
  background: linear-gradient(135deg, #81c784 50%, #ffb74d 50%);
}

tbody tr:hover {
  background: #f5f5f5;
}

.legend {
  display: flex;
  gap: 1.5rem;
  margin-top: 1rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.swatch {
  width: 16px;
  height: 16px;
  border: 1px solid #ccc;
}

.swatch.sow { background: #81c784; }
.swatch.plant { background: #ffb74d; }
.swatch.both { background: linear-gradient(135deg, #81c784 50%, #ffb74d 50%); }

.empty {
  color: #666;
  text-align: center;
  padding: 2rem;
}
</style>
