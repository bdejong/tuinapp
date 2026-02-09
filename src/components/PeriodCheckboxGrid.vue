<script setup lang="ts">
import { computed } from 'vue';
import { MONTHS } from '../types';

const props = defineProps<{
  modelValue: number;
  label: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

const periods = computed(() => {
  const result: boolean[] = [];
  for (let i = 0; i < 24; i++) {
    result.push((props.modelValue & (1 << i)) !== 0);
  }
  return result;
});

const togglePeriod = (index: number) => {
  const newValue = props.modelValue ^ (1 << index);
  emit('update:modelValue', newValue);
};
</script>

<template>
  <div class="period-grid">
    <div class="period-label">{{ label }}</div>
    <div class="grid">
      <div class="header-row">
        <div class="corner"></div>
        <div v-for="month in MONTHS" :key="month" class="month-header">
          {{ month }}
        </div>
      </div>
      <div class="period-row">
        <div class="row-label">Early</div>
        <div
          v-for="(_, monthIndex) in MONTHS"
          :key="`early-${monthIndex}`"
          class="cell"
          :class="{ active: periods[monthIndex * 2] }"
          @click="togglePeriod(monthIndex * 2)"
        ></div>
      </div>
      <div class="period-row">
        <div class="row-label">Late</div>
        <div
          v-for="(_, monthIndex) in MONTHS"
          :key="`late-${monthIndex}`"
          class="cell"
          :class="{ active: periods[monthIndex * 2 + 1] }"
          @click="togglePeriod(monthIndex * 2 + 1)"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.period-grid {
  margin: 0.6rem 0;
}

.period-label {
  font-weight: 600;
  margin-bottom: 0.3rem;
  font-size: 0.8rem;
}

.grid {
  display: inline-block;
  border: 1px solid #ccc;
}

.header-row, .period-row {
  display: flex;
}

.corner, .row-label {
  width: 36px;
  padding: 2px 4px;
  font-size: 0.65rem;
  background: #f5f5f5;
  border-right: 1px solid #ccc;
}

.month-header {
  width: 30px;
  text-align: center;
  padding: 2px;
  font-size: 0.65rem;
  background: #f5f5f5;
  border-right: 1px solid #eee;
}

.cell {
  width: 30px;
  height: 18px;
  border: 1px solid #eee;
  cursor: pointer;
  background: white;
}

.cell:hover {
  background: #e8f5e9;
}

.cell.active {
  background: #4caf50;
}

.period-row {
  border-top: 1px solid #eee;
}
</style>
