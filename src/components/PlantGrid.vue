<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import type { Plant } from '../types';
import { MONTHS } from '../types';
import { useLoadState } from '../composables/useLoadState';
import { getAllPlants } from '../api';

const plants = ref<Plant[]>([]);
const displayMode = ref('all');
const today = ref(new Date());
const visiblePlants = computed(() => {
  const monthMask = 3 << (today.value.getMonth() * 2);
  return displayMode.value === 'month'
    ? plants.value.filter(plant => ((plant.sow_periods | plant.plant_periods) & monthMask) !== 0)
    : plants.value;
});
const currentPeriod = computed(() => today.value.getMonth() * 2 + (today.value.getDate() > 15 ? 1 : 0));
const currentPeriodLabel = computed(() => `${currentPeriod.value % 2 ? 'late' : 'early'} ${MONTHS[today.value.getMonth()]}`);
const isCurrentPeriod = (month: number, late: boolean) => month * 2 + Number(late) === currentPeriod.value;
let dateTimer: ReturnType<typeof setTimeout>;
function updateDate() {
  today.value = new Date();
  const midnight = new Date(today.value.getFullYear(), today.value.getMonth(), today.value.getDate() + 1);
  dateTimer = setTimeout(updateDate, midnight.getTime() - today.value.getTime());
}
onMounted(updateDate);
onUnmounted(() => clearTimeout(dateTimer));

const { loading, loadError, load } = useLoadState();
const loadPlants = () => load(async () => { plants.value = await getAllPlants(); });
onMounted(loadPlants);

const emit = defineEmits<{
  edit: [plant: Plant];
}>();

const isPeriodActive = (periods: number, monthIndex: number, isLate: boolean): boolean => {
  const bitIndex = monthIndex * 2 + (isLate ? 1 : 0);
  return (periods & (1 << bitIndex)) !== 0;
};
const periodText = (plant: Plant, monthIndex: number, late: boolean) => {
  const sow = isPeriodActive(plant.sow_periods, monthIndex, late);
  const planting = isPeriodActive(plant.plant_periods, monthIndex, late);
  return sow && planting ? 'S/P' : sow ? 'S' : planting ? 'P' : '';
};
const periodLabel = (plant: Plant, monthIndex: number, late: boolean) =>
  `${plant.name}, ${late ? 'late' : 'early'} ${MONTHS[monthIndex]}: ${periodText(plant, monthIndex, late).replace('S/P', 'sow and plant').replace(/^S$/, 'sow').replace(/^P$/, 'plant') || 'nothing planned'}${isCurrentPeriod(monthIndex, late) ? ' (current period)' : ''}`;
</script>

<template>
  <div class="plant-grid">
    <div class="overview-header">
      <h1>Plant Overview</h1>
      <div class="overview-options">
        <span v-if="!loading && !loadError" class="record-count">{{ visiblePlants.length }} of {{ plants.length }} plants</span>
        <label>Show <select v-model="displayMode" aria-label="Plants shown"><option value="all">All plants</option><option value="month">Active in {{ MONTHS[today.getMonth()] }}</option></select></label>
      </div>
    </div>
    <div class="legend">
      <span class="legend-item"><span class="swatch sow"></span> S = Sow</span>
      <span class="legend-item"><span class="swatch plant"></span> P = Plant</span>
      <span class="legend-item"><span class="swatch both"></span> S/P = Both</span>
      <span class="legend-item"><span class="swatch current-period"></span> Now: {{ currentPeriodLabel }}</span>
    </div>
    <p class="grid-hint">E = days 1–15 · L = day 16 onwards. Select a plant to edit it.</p>

    <p v-if="loading" role="status">Loading the overview…</p>
    <div v-else-if="loadError" role="alert">{{ loadError }} <button @click="loadPlants">Try again</button></div>
    <div class="grid-container" v-else-if="visiblePlants.length > 0" role="region" aria-label="Annual plant schedule" tabindex="0">
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
            <template v-for="(month, monthIndex) in MONTHS" :key="month + '-sub'">
              <th class="sub-header" :class="{'current-period': isCurrentPeriod(monthIndex, false)}" :aria-current="isCurrentPeriod(monthIndex, false) ? 'date' : undefined" :aria-label="`Early ${month}${isCurrentPeriod(monthIndex, false) ? ', current period' : ''}`">E</th>
              <th class="sub-header" :class="{'current-period': isCurrentPeriod(monthIndex, true)}" :aria-current="isCurrentPeriod(monthIndex, true) ? 'date' : undefined" :aria-label="`Late ${month}${isCurrentPeriod(monthIndex, true) ? ', current period' : ''}`">L</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plant in visiblePlants" :key="plant.id" @click="emit('edit', plant)">
            <td class="plant-name"><button class="row-name" @click.stop="emit('edit', plant)">{{ plant.name }}</button></td>
            <template v-for="(_, monthIndex) in MONTHS" :key="monthIndex">
              <td
                class="period-cell"
                :title="periodLabel(plant, monthIndex, false)"
                :aria-label="periodLabel(plant, monthIndex, false)"
                :class="{
                  'current-period': isCurrentPeriod(monthIndex, false),
                  'sow': isPeriodActive(plant.sow_periods, monthIndex, false),
                  'plant': isPeriodActive(plant.plant_periods, monthIndex, false),
                  'both': isPeriodActive(plant.sow_periods, monthIndex, false) && isPeriodActive(plant.plant_periods, monthIndex, false),
                }"
              >{{ periodText(plant, monthIndex, false) }}</td>
              <td
                class="period-cell"
                :title="periodLabel(plant, monthIndex, true)"
                :aria-label="periodLabel(plant, monthIndex, true)"
                :class="{
                  'current-period': isCurrentPeriod(monthIndex, true),
                  'sow': isPeriodActive(plant.sow_periods, monthIndex, true),
                  'plant': isPeriodActive(plant.plant_periods, monthIndex, true),
                  'both': isPeriodActive(plant.sow_periods, monthIndex, true) && isPeriodActive(plant.plant_periods, monthIndex, true),
                }"
              >{{ periodText(plant, monthIndex, true) }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="plants.length > 0" class="empty">No sowing or planting planned in {{ MONTHS[today.getMonth()] }}.</p>
    <p v-else class="empty">No plants yet. Add plants to see the overview.</p>


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

<style scoped>.row-name {border:0;background:transparent;text-align:left;color:inherit;cursor:pointer;}.plant-name {position:sticky;left:0;background:#fafbf7;}.plant-name-header {position:sticky;left:0;background:#f5f5f5;}.period-cell {min-width:20px;}</style>

<style scoped>
.overview-header,.overview-options {display:flex;align-items:center;gap:16px;}.overview-header {justify-content:space-between;}.record-count {font-size:12px;color:#5e6a57;}.overview-options label {font-size:12px;}.overview-options select {margin-left:6px;padding:7px 10px;border:1px solid #cbd4c5;border-radius:4px;background:white;color:inherit;}h1 {font-size:24px;}.grid-hint {margin-top:12px;color:#5e6a57;font-size:12px;}
.grid-container {max-height:calc(100vh - 210px);overflow:auto;}
thead tr:first-child th {position:sticky;top:0;background:#f5f5f5;z-index:2;height:29px;}
thead tr:nth-child(2) th {position:sticky;top:29px;background:#fafafa;z-index:2;}
thead tr th:first-child {left:0;z-index:3;}.plant-name {z-index:1;white-space:nowrap;}
.period-cell {font-size:9px;color:#193120;padding:2px;}
.current-period {box-shadow:inset 2px 0 #71826a,inset -2px 0 #71826a,inset 0 0 0 100px #29482d1f;}
thead tr:nth-child(2) th.current-period {background:#dce5d6;color:#293f2c;font-weight:700;}
</style>
