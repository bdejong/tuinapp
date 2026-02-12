<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { MONTHS, type Plant, SUN_BITS } from '../types';
import { getMonthData, type MonthData } from '../api';

const currentMonth = ref(new Date().getMonth() + 1);
const data = ref<MonthData | null>(null);

const CATEGORIES = [
  { key: 'vegetable_fruit', label: 'Vegetables', icon: '🥕' },
  { key: 'flower', label: 'Flowers', icon: '🌸' },
  { key: 'herb', label: 'Herbs', icon: '🌿' },
  { key: null, label: 'Other', icon: '🌱' },
];

const getSunSymbols = (sunBits: number): string => {
  if (!sunBits) return '';
  const symbols: string[] = [];
  if (sunBits & SUN_BITS.FULL_SUN) symbols.push('***');
  if (sunBits & SUN_BITS.PARTIAL_SHADE) symbols.push('**');
  if (sunBits & SUN_BITS.FULL_SHADE) symbols.push('*');
  return `(${symbols.join(',')})`;
};

const formatPlantForPdf = (plant: Plant): string => {
  let entry = plant.name;
  const sunSymbols = getSunSymbols(plant.sun_requirements);
  if (sunSymbols) {
    entry += ` ${sunSymbols}`;
  }
  if (plant.notes) {
    entry += ' (N)';
  }
  return entry;
};

const groupByCategory = (plants: Plant[]) => {
  const groups: Record<string, Plant[]> = {};
  for (const cat of CATEGORIES) {
    groups[cat.key ?? 'other'] = [];
  }
  for (const plant of plants) {
    const key = plant.plant_type ?? 'other';
    if (groups[key]) {
      groups[key].push(plant);
    } else {
      groups['other'].push(plant);
    }
  }
  return groups;
};

const loadData = async () => {
  data.value = await getMonthData(currentMonth.value);
};

const handlePrint = async () => {
  if (!data.value) return;

  const monthName = MONTHS[currentMonth.value - 1];

  const toCategorized = (plants: Plant[]) => {
    const grouped = groupByCategory(plants);
    return {
      vegetables: grouped['vegetable_fruit'].map(formatPlantForPdf),
      flowers: grouped['flower'].map(formatPlantForPdf),
      herbs: grouped['herb'].map(formatPlantForPdf),
      other: grouped['other'].map(formatPlantForPdf),
    };
  };

  try {
    await invoke('generate_pdf', {
      data: {
        monthName,
        sowEarly: toCategorized(data.value.sow_early),
        sowLate: toCategorized(data.value.sow_late),
        plantEarly: toCategorized(data.value.plant_early),
        plantLate: toCategorized(data.value.plant_late),
        activities: data.value.activities.map(a => a.description ? `${a.name} - ${a.description}` : a.name),
      }
    });
  } catch (err) {
    console.error('PDF error:', err);
    alert('Could not generate PDF. Error: ' + err);
  }
};

onMounted(loadData);
watch(currentMonth, loadData);
</script>

<template>
  <div class="monthly-view">
    <div class="header">
      <h1>Calendar</h1>
      <div class="header-controls">
        <select v-model="currentMonth">
          <option v-for="(month, index) in MONTHS" :key="index" :value="index + 1">
            {{ month }}
          </option>
        </select>
        <button class="print-btn" @click="handlePrint">Printable PDF</button>
      </div>
    </div>

    <p v-if="data" class="hint">Select a month and click "Printable PDF" to generate a plant overview.</p>
  </div>
</template>

<style scoped>
.monthly-view {
  padding: 1rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.header select {
  padding: 0.5rem;
  font-size: 1rem;
  border-radius: 4px;
}

.header-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.print-btn {
  padding: 0.5rem 1rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.print-btn:hover {
  background: #43a047;
}

.hint {
  color: #666;
  font-size: 0.9rem;
}
</style>
