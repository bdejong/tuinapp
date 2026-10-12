import { onMounted, onUnmounted } from 'vue';

// Reload reads after sign-in without remounting forms or submitting saved drafts.
export function useSessionRestore(reload: () => void) {
  onMounted(() => window.addEventListener('session-restored', reload));
  onUnmounted(() => window.removeEventListener('session-restored', reload));
}
