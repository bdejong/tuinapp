<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { MONTHS, type Plant } from '../types';
import { getMonthData, type MonthData } from '../api';

const currentMonth = ref(new Date().getMonth() + 1);
const data = ref<MonthData | null>(null);

const CATEGORIES = [
  { key: 'vegetable_fruit', label: 'Vegetables', icon: '🥕' },
  { key: 'flower', label: 'Flowers', icon: '🌸' },
  { key: 'herb', label: 'Herbs', icon: '🌿' },
  { key: null, label: 'Other', icon: '🌱' },
];

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
      vegetables: grouped['vegetable_fruit'].map(p => p.name),
      flowers: grouped['flower'].map(p => p.name),
      herbs: grouped['herb'].map(p => p.name),
      other: grouped['other'].map(p => p.name),
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

    <!-- Print header (only visible when printing) -->
    <div class="print-header">
      <h1>Garden Planner - {{ MONTHS[currentMonth - 1] }}</h1>
    </div>

    <div v-if="data" class="content">
      <div class="section">
        <h2>Sow This Month</h2>
        <div class="time-period" v-for="period in ['early', 'late']" :key="period">
          <h3>{{ period === 'early' ? 'Early' : 'Late' }} {{ MONTHS[currentMonth - 1] }}</h3>
          <div class="categories">
            <template v-for="cat in CATEGORIES" :key="cat.key">
              <div class="category" v-if="groupByCategory(period === 'early' ? data.sow_early : data.sow_late)[cat.key ?? 'other'].length">
                <h4>{{ cat.icon }} {{ cat.label }}</h4>
                <ul>
                  <li v-for="plant in groupByCategory(period === 'early' ? data.sow_early : data.sow_late)[cat.key ?? 'other']" :key="plant.id">
                    {{ plant.name }}
                  </li>
                </ul>
              </div>
            </template>
          </div>
          <p v-if="(period === 'early' ? data.sow_early : data.sow_late).length === 0" class="empty">Nothing to sow</p>
        </div>
      </div>

      <div class="section">
        <h2>Plant This Month</h2>
        <div class="time-period" v-for="period in ['early', 'late']" :key="period">
          <h3>{{ period === 'early' ? 'Early' : 'Late' }} {{ MONTHS[currentMonth - 1] }}</h3>
          <div class="categories">
            <template v-for="cat in CATEGORIES" :key="cat.key">
              <div class="category" v-if="groupByCategory(period === 'early' ? data.plant_early : data.plant_late)[cat.key ?? 'other'].length">
                <h4>{{ cat.icon }} {{ cat.label }}</h4>
                <ul>
                  <li v-for="plant in groupByCategory(period === 'early' ? data.plant_early : data.plant_late)[cat.key ?? 'other']" :key="plant.id">
                    {{ plant.name }}
                  </li>
                </ul>
              </div>
            </template>
          </div>
          <p v-if="(period === 'early' ? data.plant_early : data.plant_late).length === 0" class="empty">Nothing to plant</p>
        </div>
      </div>

      <div class="section">
        <h2>Activities</h2>
        <ul v-if="data.activities.length">
          <li v-for="activity in data.activities" :key="activity.id">
            <strong>{{ activity.name }}</strong>
            <span v-if="activity.description"> - {{ activity.description }}</span>
          </li>
        </ul>
        <p v-else class="empty">No activities this month</p>
      </div>
    </div>
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

.content {
  display: grid;
  gap: 1.5rem;
}

.section {
  background: white;
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.section h2 {
  margin-bottom: 1rem;
  color: #333;
}

.time-period {
  margin-bottom: 1rem;
}

.time-period h3 {
  font-size: 0.95rem;
  color: #555;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.25rem;
}

.categories {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

.category h4 {
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 0.25rem;
}

.category ul {
  margin-left: 0.5rem;
}

.category li {
  padding: 0.25rem 0;
  font-size: 0.9rem;
}

ul {
  list-style: none;
  padding: 0;
}

li {
  padding: 0.5rem;
  border-bottom: 1px solid #eee;
}

li:last-child {
  border-bottom: none;
}

.empty {
  color: #999;
  font-style: italic;
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

/* Hidden in normal view */
.print-header,
.print-notes {
  display: none;
}

/* Print styles */
@media print {
  .monthly-view {
    padding: 0;
  }

  .header {
    display: none;
  }

  .print-header {
    display: block;
    margin-bottom: 1.5rem;
  }

  .print-header h1 {
    font-size: 1.5rem;
    text-align: center;
    border-bottom: 2px solid #333;
    padding-bottom: 0.5rem;
  }

  .print-notes {
    display: block;
  }

  .section {
    box-shadow: none;
    border: 1px solid #ccc;
    page-break-inside: avoid;
  }

  .notes-lines {
    margin-top: 0.5rem;
  }

  .note-line {
    height: 1.5rem;
    border-bottom: 1px solid #ddd;
  }

  .content {
    gap: 1rem;
  }
}
</style>
