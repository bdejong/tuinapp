import { ref } from 'vue';
import { useSessionRestore } from './useSessionRestore';

export function useLoadState() {
  const loading = ref(true);
  const loadError = ref('');
  let lastAction: (() => Promise<void>) | undefined;
  useSessionRestore(() => { if (lastAction) void load(lastAction); });
  async function load(action: () => Promise<void>) {
    lastAction = action;
    loading.value = true; loadError.value = '';
    try { await action(); }
    catch (error) { loadError.value = error instanceof Error ? error.message : 'Could not load your garden.'; }
    finally { loading.value = false; }
  }
  return { loading, loadError, load };
}
