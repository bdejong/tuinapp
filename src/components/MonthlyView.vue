<script setup lang="ts">
import { useSessionRestore } from '../composables/useSessionRestore';
import { ref, watch, onMounted } from 'vue';
import { MONTHS, type Plant } from '../types';
import { getMonthData, getMonthPdf, type MonthData } from '../api';
const currentMonth = ref(new Date().getMonth() + 1);
const error = ref('');
const pdfError = ref('');
const printing = ref(false);
const data = ref<MonthData | null>(null); const loading = ref(false);
const categories = [{ key: 'vegetable_fruit', label: 'Vegetables & fruit' }, { key: 'flower', label: 'Flowers' }, { key: 'herb', label: 'Herbs' }, { key: null, label: 'Other' }];
const sections = [{ key: 'sow_early', label: 'Sow · early' }, { key: 'sow_late', label: 'Sow · late' }, { key: 'plant_early', label: 'Plant · early' }, { key: 'plant_late', label: 'Plant · late' }] as const;
const grouped = (plants: Plant[], category: string | null) => plants.filter(p => (p.plant_type ?? null) === category);
const sun = (value: number) => [value & 1 ? 'Sun' : '', value & 2 ? 'Partial shade' : '', value & 4 ? 'Shade' : ''].filter(Boolean).join(', ');
let generation = 0;
async function load() {
  const request = ++generation; loading.value = true; error.value = ""; pdfError.value = "";
  try { const result = await getMonthData(currentMonth.value); if (request === generation) data.value = result; }
  catch (e) { if (request === generation) { data.value = null; error.value = e instanceof Error ? e.message : 'Could not load this month'; } }
  finally { if (request === generation) loading.value = false; }
}
async function print() {
  if (printing.value || loading.value || !data.value) return;
  printing.value = true; pdfError.value = '';
  const month = currentMonth.value;
  try {
    const blob = await getMonthPdf(month);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `garden-planner-${MONTHS[month - 1].toLowerCase()}.pdf`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    pdfError.value = e instanceof Error ? e.message : 'Could not generate the PDF. Please try again.';
  } finally { printing.value = false; }
}
onMounted(load); watch(currentMonth, load);
useSessionRestore(() => { void load(); });
</script>
<template>
  <div class="monthly-view">
    <div class="header"><div><h1>{{ MONTHS[currentMonth - 1] }} in the garden</h1><p>Your sowing, planting, and activity plan.</p></div>
      <div class="header-controls"><select v-model="currentMonth" aria-label="Calendar month" :disabled="printing"><option v-for="(month, index) in MONTHS" :key="month" :value="index + 1">{{ month }}</option></select><button @click="print" :disabled="!data || loading || printing">{{ printing ? 'Preparing PDF…' : 'Printable PDF' }}</button></div>
    </div>
    <p v-if="pdfError" role="alert">{{ pdfError }} <button @click="print" :disabled="printing || loading || !data">Retry PDF</button></p>
    <p v-if="printing" role="status">Preparing your printable PDF…</p>
    <p v-if="loading" role="status">Loading the month…</p>
    <p v-else-if="error" role="alert">{{ error }} <button @click="load">Try again</button></p>
    <template v-else-if="data">
      <div class="month-sections"><section v-for="section in sections" :key="section.key">
        <h2>{{ section.label }} {{ MONTHS[currentMonth - 1] }}</h2>
        <p v-if="!data[section.key].length" class="empty">Nothing planned for this period.</p>
        <template v-for="category in categories" :key="category.label"><div v-if="grouped(data[section.key], category.key).length" class="category">
          <h3>{{ category.label }}</h3><ul><li v-for="plant in grouped(data[section.key], category.key)" :key="plant.id"><strong>{{ plant.name }}</strong><span class="sun" v-if="plant.sun_requirements">{{ sun(plant.sun_requirements) }}</span><p v-if="plant.notes" class="notes">{{ plant.notes }}</p></li></ul>
        </div></template>
      </section></div>
      <section class="activities"><h2>Garden activities</h2><p v-if="!data.activities.length" class="empty">No activities this month.</p><ul><li v-for="activity in data.activities" :key="activity.id"><strong>{{ activity.name }}</strong><p v-if="activity.description">{{ activity.description }}</p></li></ul></section>
    </template>
  </div>
</template>
<style scoped>
.monthly-view {padding:24px;max-width:1500px;margin:auto;}.header {display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;gap:24px;}h1 {font-size:24px;}.header p {margin-top:8px;color:#697263;}.header-controls {display:flex;gap:10px;}select,button {padding:9px 12px;border:1px solid #cbd4c5;border-radius:5px;background:white;}button {background:#386145;color:white;cursor:pointer;}.month-sections {display:grid;grid-template-columns:1fr 1fr;gap:20px;}section {border:1px solid #dce2d5;border-radius:8px;background:white;padding:22px;}h2 {font-size:18px;color:#354e31;margin-bottom:18px;}h3 {font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:#57674a;margin:18px 0 10px;}ul {list-style:none;}li {padding:10px 0;border-bottom:1px solid #edf0e8;break-inside:avoid;}.sun {font-size:11px;color:#6b7a62;margin-left:12px;}.notes,li p {white-space:pre-wrap;color:#626d5b;margin-top:5px;line-height:1.5;}.empty {color:#616d57;}.activities {margin-top:20px;}
@media print {.header-controls {display:none;}.monthly-view {padding:0;max-width:none;}.month-sections {display:block;}section {border:0;padding:0 0 16px;break-inside:auto;}h2,h3 {break-after:avoid;}.activities {margin-top:0;}li {font-size:10pt;}}
@media (max-width: 700px) {
  .monthly-view { padding: 18px 12px; }
  .header { display: block; margin-bottom: 16px; }
  h1 { font-size: 22px; }
  .header-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin-top: 14px; }
  .header-controls select, .header-controls button { min-width: 0; min-height: 44px; padding: 8px; }
  .month-sections { grid-template-columns: 1fr; gap: 12px; }
  section { padding: 16px 14px; }
  h2 { margin-bottom: 12px; }
  h1, h2, h3, li, li strong, .notes { overflow-wrap: anywhere; }
  .sun { display: block; margin: 4px 0 0; }
}
</style>
