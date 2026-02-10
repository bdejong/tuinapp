<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Plant, PlantPhoto } from '../types';
import { PLANT_TYPES, SUN_REQUIREMENTS } from '../types';
import { getAllPlants, createPlant, updatePlant, deletePlant, getPhotos } from '../api';
import PlantForm from './PlantForm.vue';

const getTypeIcon = (type: string | undefined): string => {
  const found = PLANT_TYPES.find(t => t.value === type);
  return found?.icon || '-';
};

const getSunIcon = (sun: string | undefined): string => {
  const found = SUN_REQUIREMENTS.find(s => s.value === sun);
  return found?.icon || '-';
};

const plants = ref<Plant[]>([]);
const plantPhotos = ref<Map<number, PlantPhoto[]>>(new Map());
const showForm = ref(false);
const editingPlant = ref<Plant | undefined>();
const searchQuery = ref('');
const enlargedPhotos = ref<PlantPhoto[]>([]);
const currentPhotoIndex = ref(0);

const filteredPlants = computed(() => {
  if (!searchQuery.value.trim()) return plants.value;
  const query = searchQuery.value.toLowerCase();
  return plants.value.filter(plant =>
    plant.name.toLowerCase().includes(query)
  );
});

const loadPlants = async () => {
  plants.value = await getAllPlants();
  // Load all photos for each plant
  for (const plant of plants.value) {
    if (plant.id) {
      const photos = await getPhotos(plant.id);
      if (photos.length > 0) {
        plantPhotos.value.set(plant.id, photos);
      }
    }
  }
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

const getPlantPhotos = (plantId: number | undefined): PlantPhoto[] => {
  if (!plantId) return [];
  return plantPhotos.value.get(plantId) || [];
};

const openEnlargedPhotos = (event: Event, plantId: number) => {
  event.stopPropagation();
  const photos = getPlantPhotos(plantId);
  if (photos.length > 0) {
    enlargedPhotos.value = photos;
    currentPhotoIndex.value = 0;
  }
};

const closeEnlargedPhotos = () => {
  enlargedPhotos.value = [];
  currentPhotoIndex.value = 0;
};

const nextPhoto = () => {
  if (currentPhotoIndex.value < enlargedPhotos.value.length - 1) {
    currentPhotoIndex.value++;
  }
};

const prevPhoto = () => {
  if (currentPhotoIndex.value > 0) {
    currentPhotoIndex.value--;
  }
};

defineExpose({ openAddForm, openEditForm });
</script>

<template>
  <div class="plant-list">
    <div class="header">
      <h1>Plants</h1>
      <button class="add-btn" @click="openAddForm">+ Add Plant</button>
    </div>

    <div class="search-bar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search plants..."
        class="search-input"
      />
    </div>

    <table v-if="filteredPlants.length > 0">
      <thead>
        <tr>
          <th class="photo-header">Photo</th>
          <th>Name</th>
          <th class="icon-header">Type</th>
          <th class="icon-header">Sun</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plant in filteredPlants" :key="plant.id" @click="openEditForm(plant)">
          <td class="photo-cell">
            <span
              v-if="getPlantPhotos(plant.id).length > 0"
              class="photo-icon"
              @click="(e) => openEnlargedPhotos(e, plant.id!)"
              :title="getPlantPhotos(plant.id).length + ' photo(s)'"
            >📷</span>
            <span v-else class="no-photo">-</span>
          </td>
          <td>{{ plant.name }}</td>
          <td class="icon-cell" :title="plant.plant_type?.replace('_', '/')">{{ getTypeIcon(plant.plant_type) }}</td>
          <td class="icon-cell" :title="plant.sun_requirement?.replace('_', ' ')">{{ getSunIcon(plant.sun_requirement) }}</td>
        </tr>
      </tbody>
    </table>

    <p v-else-if="plants.length > 0" class="empty">No plants match your search.</p>
    <p v-else class="empty">No plants yet. Add your first plant!</p>

    <!-- Enlarged photo modal -->
    <div v-if="enlargedPhotos.length > 0" class="photo-modal" @click="closeEnlargedPhotos">
      <div class="photo-modal-content" @click.stop>
        <div class="photo-nav">
          <button
            v-if="enlargedPhotos.length > 1"
            class="nav-btn prev"
            :disabled="currentPhotoIndex === 0"
            @click="prevPhoto"
          >&lt;</button>
          <img
            :src="'data:image/jpeg;base64,' + enlargedPhotos[currentPhotoIndex].image_data"
            alt="Enlarged photo"
          />
          <button
            v-if="enlargedPhotos.length > 1"
            class="nav-btn next"
            :disabled="currentPhotoIndex === enlargedPhotos.length - 1"
            @click="nextPhoto"
          >&gt;</button>
        </div>
        <div class="photo-info">
          <span v-if="enlargedPhotos.length > 1">{{ currentPhotoIndex + 1 }} / {{ enlargedPhotos.length }}</span>
        </div>
        <button class="close-btn" @click="closeEnlargedPhotos">Close</button>
      </div>
    </div>

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
  background: #4caf50;
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
  border-color: #4caf50;
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

.photo-header {
  text-align: center;
  width: 50px;
}

.photo-cell {
  text-align: center;
}

.photo-icon {
  cursor: pointer;
  font-size: 1rem;
}

.photo-icon:hover {
  transform: scale(1.2);
  display: inline-block;
}

.no-photo {
  color: #ccc;
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

/* Enlarged photo modal */
.photo-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.photo-modal-content {
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.photo-nav {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.photo-nav img {
  max-width: 70vw;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 8px;
}

.nav-btn {
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 1.5rem;
  font-weight: bold;
  color: #333;
}

.nav-btn:hover:not(:disabled) {
  background: white;
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.photo-info {
  color: white;
  margin-top: 0.5rem;
  font-size: 0.9rem;
}

.close-btn {
  margin-top: 1rem;
  padding: 0.5rem 1.5rem;
  border: none;
  border-radius: 4px;
  background: #e0e0e0;
  cursor: pointer;
  font-size: 0.9rem;
}

.close-btn:hover {
  background: #d0d0d0;
}
</style>
