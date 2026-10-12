import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSessionRestore } from './useSessionRestore';

export function useDialog(visible: () => boolean, close: () => void) {
  const dialog = ref<HTMLElement | null>(null);
  let previousFocus: HTMLElement | null = null;
  const focusable = () => Array.from(dialog.value?.querySelectorAll<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex="0"]') ?? []).filter(el => el.getAttribute('type') !== 'hidden');
  async function opened() {
    if (!visible()) return;
    previousFocus = document.activeElement as HTMLElement;
    await nextTick(); focusable()[0]?.focus();
  }
  function restoreFocus() { if (previousFocus?.isConnected) previousFocus.focus(); }
  function keyboard(event: KeyboardEvent) {
    if (!visible() || !dialog.value || !dialog.value.contains(document.activeElement)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const items = focusable(); const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  useSessionRestore(() => { if (visible()) focusable()[0]?.focus(); });
  watch(visible, value => value ? opened() : restoreFocus());
  onMounted(() => { opened(); document.addEventListener('keydown', keyboard); });
  onUnmounted(() => { document.removeEventListener('keydown', keyboard); restoreFocus(); });
  return dialog;
}
