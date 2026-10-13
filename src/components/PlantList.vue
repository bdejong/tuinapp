<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useLoadState } from '../composables/useLoadState';
import type { Plant } from '../types';
import { PLANT_TYPES, SUN_REQUIREMENTS } from '../types';
import { getAllPlants, createPlant, updatePlant, deletePlant } from '../api';
import PlantForm from './PlantForm.vue';
import SunIcon from './SunIcon.vue';

const getTypeIcon = (type: string | undefined): string => {
  const found = PLANT_TYPES.find(t => t.value === type);
  return found?.icon || '-';
};

const plants = ref<Plant[]>([]);
const showForm = ref(false);
const formKey = ref(0);
const saving = ref(false);
const editingPlant = ref<Plant | undefined>();
const searchQuery = ref('');

const filteredPlants = computed(() => {
  if (!searchQuery.value.trim()) return plants.value;
  const query = searchQuery.value.trim().toLowerCase();
  return plants.value.filter(plant =>
    plant.name.toLowerCase().includes(query)
  );
});

const { loading, loadError, load } = useLoadState();
const loadPlants = () => load(async () => { plants.value = await getAllPlants(); });

onMounted(() => loadPlants().catch(() => {}));

const openAddForm = () => {
  if (showForm.value) return;
  editingPlant.value = undefined;
  showForm.value = true;
};

const openEditForm = (plant: Plant) => {
  editingPlant.value = plant;
  showForm.value = true;
};

const handleSave = async (plant: Plant) => {
  if (saving.value) return;
  saving.value = true;
  try {
    if (plant.id) await updatePlant(plant); else await createPlant(plant);
    showForm.value = false; await loadPlants();
  } catch {} finally { saving.value = false; }
};
const handleSaveAndAdd = async (plant: Plant) => {
  if (saving.value) return;
  saving.value = true;
  try { await createPlant(plant); editingPlant.value = undefined; formKey.value++; await loadPlants(); }
  catch {} finally { saving.value = false; }
};

const handleDelete = async (id: number) => {
  if (saving.value) return;
  saving.value = true;
  try { await deletePlant(id, editingPlant.value?.revision); await loadPlants(); showForm.value = false; }
  catch {} finally { saving.value = false; }
};

defineExpose({ openAddForm, openEditForm });
</script>

<template>
  <div class="plant-list">
    <div class="header">
      <h1>Plants <span class="record-count">{{ plants.length }}</span></h1>
      <button class="add-btn" @click="openAddForm">+ Add Plant</button>
    </div>

    <div class="search-bar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search plants..."
        aria-label="Search plants"
        class="search-input"
      />
    </div>

    <p v-if="loading" role="status" class="empty">Loading plants…</p>
    <div v-else-if="loadError" class="load-error" role="alert"><p>{{ loadError }}</p><button @click="loadPlants">Try again</button></div>
    <table v-else-if="filteredPlants.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th class="icon-header">Type</th>
          <th class="icon-header">Sun</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plant in filteredPlants" :key="plant.id" @click="openEditForm(plant)">
          <td><button class="row-name" @click.stop="openEditForm(plant)">{{ plant.name }}</button></td>
          <td class="icon-cell" :title="plant.plant_type?.replace('_', '/')">{{ getTypeIcon(plant.plant_type) }}</td>
          <td class="icon-cell"><span class="sun-icons" v-if="plant.sun_requirements"><SunIcon v-for="opt in SUN_REQUIREMENTS.filter(opt => plant.sun_requirements & opt.bit)" :key="opt.value" :value="opt.value" /></span><span v-else aria-label="Sun requirement not specified">-</span></td>
        </tr>
      </tbody>
    </table>

    <p v-else-if="plants.length > 0" class="empty">No plants match your search.</p>
    <p v-else class="empty">No plants yet. Add your first plant!</p>

    <PlantForm
      :key="formKey"
      :busy="saving"
      :visible="showForm"
      :plant="editingPlant"
      @save="handleSave"
      @save-and-add="handleSaveAndAdd"
      @delete="handleDelete"
      @close="showForm = false; loadPlants()"
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
  background: #386145;
  color: white;
  border: none;
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.search-bar {
  margin-bottom: 0.75rem;
}

.search-input {
  width: 100%;
  max-width: 300px;
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.8rem;
}

.search-input:focus {
  outline: none;
  border-color: #386145;
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
  width: 75px;
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

.sun-icons {display:inline-flex;align-items:center;gap:3px;}
@media (max-width: 700px) {
  .plant-list { padding: 16px 12px; }
  .header { gap: 8px; }
  .header h1 { font-size: 1.25rem; }
  .add-btn { min-height: 44px; padding: 8px 10px; white-space: nowrap; }
  .search-input { max-width: none; min-height: 44px; font-size: 16px; }
  th, td { padding: 8px 6px; }
  .row-name { display: flex; align-items: center; width: 100%; min-height: 44px; overflow-wrap: anywhere; }
}
</style>

<style scoped>.row-name {border:0;background:transparent;text-align:left;padding:0;color:inherit;cursor:pointer;}.load-error {margin:24px 0;padding:16px;border:1px solid #e6c3b8;background:#fff6f1;}.load-error button {margin-top:10px;padding:7px 12px;}.record-count {font-weight:400;color:#617052;font-size:13px;margin-left:8px;}</style>
