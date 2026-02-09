<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { MONTHS } from '../types';
import { getMonthData, type MonthData } from '../api';

const currentMonth = ref(new Date().getMonth() + 1);
const data = ref<MonthData | null>(null);

const loadData = async () => {
  data.value = await getMonthData(currentMonth.value);
};

onMounted(loadData);
watch(currentMonth, loadData);
</script>

<template>
  <div class="monthly-view">
    <div class="header">
      <h1>Calendar</h1>
      <select v-model="currentMonth">
        <option v-for="(month, index) in MONTHS" :key="index" :value="index + 1">
          {{ month }}
        </option>
      </select>
    </div>

    <div v-if="data" class="content">
      <div class="section">
        <h2>Sow This Month</h2>
        <div class="subsection">
          <h3>Early {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.sow_early.length">
            <li v-for="plant in data.sow_early" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to sow</p>
        </div>
        <div class="subsection">
          <h3>Late {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.sow_late.length">
            <li v-for="plant in data.sow_late" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to sow</p>
        </div>
      </div>

      <div class="section">
        <h2>Plant This Month</h2>
        <div class="subsection">
          <h3>Early {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.plant_early.length">
            <li v-for="plant in data.plant_early" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to plant</p>
        </div>
        <div class="subsection">
          <h3>Late {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.plant_late.length">
            <li v-for="plant in data.plant_late" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to plant</p>
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

.subsection {
  margin-bottom: 1rem;
}

.subsection h3 {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 0.5rem;
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
</style>
