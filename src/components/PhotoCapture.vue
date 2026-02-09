<script setup lang="ts">
import { ref, onUnmounted, watch, nextTick } from 'vue';
import type { PlantPhoto } from '../types';
import { getPhotos, addPhoto, deletePhoto } from '../api';

const props = defineProps<{
  plantId?: number;
}>();

const photos = ref<PlantPhoto[]>([]);
const videoRef = ref<HTMLVideoElement | null>(null);
const stream = ref<MediaStream | null>(null);
const showCamera = ref(false);

const loadPhotos = async () => {
  if (props.plantId) {
    photos.value = await getPhotos(props.plantId);
  } else {
    photos.value = [];
  }
};

watch(() => props.plantId, loadPhotos, { immediate: true });

const startCamera = async () => {
  try {
    // Show the video element first
    showCamera.value = true;

    // Wait for DOM to update
    await nextTick();

    // Now get the camera stream
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }
    });

    if (videoRef.value) {
      videoRef.value.srcObject = stream.value;
    }
  } catch (err) {
    showCamera.value = false;
    alert('Could not access camera: ' + err);
  }
};

const stopCamera = () => {
  if (stream.value) {
    stream.value.getTracks().forEach(track => track.stop());
    stream.value = null;
  }
  showCamera.value = false;
};

const capturePhoto = async () => {
  if (!videoRef.value || !props.plantId) return;

  const canvas = document.createElement('canvas');
  canvas.width = videoRef.value.videoWidth;
  canvas.height = videoRef.value.videoHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.drawImage(videoRef.value, 0, 0);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const base64 = dataUrl.split(',')[1];

  const sortOrder = photos.value.length + 1;
  await addPhoto(props.plantId, base64, sortOrder);
  await loadPhotos();
};

const handleDeletePhoto = async (id: number) => {
  if (confirm('Delete this photo?')) {
    await deletePhoto(id);
    await loadPhotos();
  }
};

onUnmounted(stopCamera);
</script>

<template>
  <div class="photo-capture">
    <div class="photos-grid">
      <div v-for="photo in photos" :key="photo.id" class="photo-item">
        <img :src="'data:image/jpeg;base64,' + photo.image_data" alt="Plant photo" />
        <button class="delete-btn" @click="handleDeletePhoto(photo.id!)">×</button>
      </div>

      <div v-if="!showCamera" class="add-photo" @click="startCamera">
        <span>+ Add Photo</span>
      </div>
    </div>

    <div v-if="showCamera" class="camera-container">
      <video ref="videoRef" autoplay playsinline></video>
      <div class="camera-controls">
        <button @click="capturePhoto">Capture</button>
        <button @click="stopCamera">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.photo-capture {
  margin: 1rem 0;
}

.photos-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.photo-item {
  position: relative;
  width: 100px;
  height: 100px;
}

.photo-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}

.photo-item .delete-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  background: rgba(255, 0, 0, 0.8);
  color: white;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.add-photo {
  width: 100px;
  height: 100px;
  border: 2px dashed #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #666;
}

.add-photo:hover {
  border-color: #4caf50;
  color: #4caf50;
}

.camera-container {
  margin-top: 1rem;
}

.camera-container video {
  width: 100%;
  max-width: 400px;
  border-radius: 4px;
}

.camera-controls {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.camera-controls button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.camera-controls button:first-child {
  background: #4caf50;
  color: white;
}

.camera-controls button:last-child {
  background: #e0e0e0;
}
</style>
