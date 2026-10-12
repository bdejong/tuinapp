<script setup lang="ts">
import { computed } from 'vue';
import { SUN_REQUIREMENTS } from '../types';
const props = defineProps<{ value: typeof SUN_REQUIREMENTS[number]['value']; decorative?: boolean }>();
const option = computed(() => SUN_REQUIREMENTS.find(option => option.value === props.value)!);
</script>
<template>
  <img class="sun-icon" :src="option.icon" :alt="decorative ? '' : option.label" :title="option.label" :aria-hidden="decorative ? true : undefined" width="22" height="22" />
</template>
<style scoped>
.sun-icon {display:inline-block;vertical-align:middle;flex-shrink:0;}
</style>
