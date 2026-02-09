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
const enlargedPhoto = ref<PlantPhoto | null>(null);
const confirmingDeleteId = ref<number | null>(null);

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
  if (!videoRef.value || !props.plantId) {
    return;
  }

  const video = videoRef.value;

  // Check if video has dimensions
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      alert('Could not create canvas context');
      return;
    }

    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.split(',')[1];

    const sortOrder = photos.value.length + 1;
    await addPhoto(props.plantId, base64, sortOrder);
    await loadPhotos();

    // Stop camera after successful capture
    stopCamera();
  } catch (err) {
    alert('Failed to capture photo: ' + err);
  }
};

const handleDeletePhoto = (event: Event, id: number) => {
  event.stopPropagation();
  confirmingDeleteId.value = id;
};

const confirmDeletePhoto = async () => {
  const id = confirmingDeleteId.value;
  if (!id) return;

  try {
    await deletePhoto(id);
    await loadPhotos();
    if (enlargedPhoto.value?.id === id) {
      enlargedPhoto.value = null;
    }
  } catch (err) {
    console.error('deletePhoto failed:', err);
  }
  confirmingDeleteId.value = null;
};

const cancelDeletePhoto = () => {
  confirmingDeleteId.value = null;
};

const openEnlargedView = (photo: PlantPhoto) => {
  enlargedPhoto.value = photo;
};

const closeEnlargedView = () => {
  enlargedPhoto.value = null;
};

onUnmounted(stopCamera);
</script>

<template>
  <div class="photo-capture">
    <div class="photos-grid">
      <div
        v-for="photo in photos"
        :key="photo.id"
        class="photo-item"
        :class="{ confirming: confirmingDeleteId === photo.id }"
        @click="openEnlargedView(photo)"
      >
        <img :src="'data:image/jpeg;base64,' + photo.image_data" alt="Plant photo" />
        <template v-if="confirmingDeleteId === photo.id">
          <div class="confirm-overlay" @click.stop>
            <button class="confirm-yes" @click="confirmDeletePhoto">🗑️</button>
            <button class="confirm-no" @click="cancelDeletePhoto">✕</button>
          </div>
        </template>
        <button v-else class="delete-btn" @click="(e) => handleDeletePhoto(e, photo.id!)">×</button>
      </div>

      <div v-if="!showCamera" class="add-photo" @click="startCamera">
        <span>📷 Add</span>
      </div>
    </div>

    <div v-if="showCamera" class="camera-container">
      <video ref="videoRef" autoplay playsinline></video>
      <div class="camera-controls">
        <button @click="capturePhoto">📸 Capture</button>
        <button @click="stopCamera">Cancel</button>
      </div>
    </div>

    <!-- Enlarged photo modal -->
    <div v-if="enlargedPhoto" class="photo-modal" @click="closeEnlargedView">
      <div class="photo-modal-content" @click.stop>
        <img :src="'data:image/jpeg;base64,' + enlargedPhoto.image_data" alt="Enlarged photo" />
        <div class="photo-modal-controls">
          <template v-if="confirmingDeleteId === enlargedPhoto.id">
            <span class="confirm-text">Delete?</span>
            <button class="delete-btn-large" @click="confirmDeletePhoto">Yes</button>
            <button @click="cancelDeletePhoto">No</button>
          </template>
          <template v-else>
            <button class="delete-btn-large" @click="(e) => handleDeletePhoto(e, enlargedPhoto!.id!)">
              🗑️ Delete
            </button>
            <button @click="closeEnlargedView">Close</button>
          </template>
        </div>
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
  cursor: pointer;
}

.photo-item:hover {
  opacity: 0.9;
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
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(255, 0, 0, 0.9);
  color: white;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.photo-item .delete-btn:hover {
  background: rgba(255, 0, 0, 1);
  transform: scale(1.1);
}

.photo-item.confirming img {
  opacity: 0.5;
}

.confirm-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.confirm-yes, .confirm-no {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
}

.confirm-yes {
  background: #f44336;
  color: white;
}

.confirm-no {
  background: #e0e0e0;
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
  font-size: 0.9rem;
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
  background: #000;
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

/* Photo modal styles */
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

.photo-modal-content img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
}

.photo-modal-controls {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
  align-items: center;
}

.photo-modal-controls .confirm-text {
  color: #f44336;
  font-weight: 500;
}

.photo-modal-controls button {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}

.delete-btn-large {
  background: #f44336;
  color: white;
}

.delete-btn-large:hover {
  background: #d32f2f;
}

.photo-modal-controls button:last-child {
  background: #e0e0e0;
}

.photo-modal-controls button:last-child:hover {
  background: #d0d0d0;
}
</style>
