import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import PeriodCheckboxGrid from '../../src/components/PeriodCheckboxGrid.vue';
import PlantForm from '../../src/components/PlantForm.vue';
import ActivityForm from '../../src/components/ActivityForm.vue';
import { MONTHS } from '../../src/types';

const fixtures = {
  plant: { id: 8, name: 'Courgette', notes: 'Original note', plant_type: 'herb', sun_requirements: 3, sow_periods: 1, plant_periods: 8388608, needs_reorder: true, revision: 1 },
  activity: { id: 9, name: 'Prune', description: 'Original description', active_periods: 9, revision: 1 },
};
describe('Season controls', () => {
  it('renders all 24 labelled keyboard controls and their selected state', () => {
    const wrapper = mount(PeriodCheckboxGrid, { props: { modelValue: 0xffffff, label: 'Sowing' } });
    expect(wrapper.findAll('button')).toHaveLength(24);
    for (const button of wrapper.findAll('button')) expect(button.attributes('aria-pressed')).toBe('true');
  });
  it.each([0, 1, 10, 11, 22, 23])('toggles bit %i without changing other seasons', async bit => {
    const wrapper = mount(PeriodCheckboxGrid, { props: { modelValue: 0, label: 'Sowing' } });
    const label = `Sowing: ${bit % 2 ? 'late' : 'early'} ${MONTHS[Math.floor(bit / 2)]}`;
    await wrapper.get(`[aria-label="${label}"]`).trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([1 << bit]);
    await wrapper.setProps({ modelValue: 0xffffff }); await wrapper.get(`[aria-label="${label}"]`).trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([0xffffff ^ (1 << bit)]);
  });
});

for (const kind of ['plant', 'activity'] as const) {
  const Component = kind === 'plant' ? PlantForm : ActivityForm;
  const mountForm = (editing = false, busy = false) => mount(Component as typeof PlantForm, { attachTo: document.body, props: { visible: true, busy, ...(editing ? { [kind]: fixtures[kind] } : {}) } });
  describe(`${kind} form`, () => {
    it('rejects a blank name without emitting a save', async () => {
      const wrapper = mountForm(); await wrapper.get('form').trigger('submit');
      expect(wrapper.get('[role=alert]').text()).toContain('enter a name'); expect(wrapper.emitted('save')).toBeUndefined();
    });
    it('rejects whitespace for Save and Add Another too', async () => {
      const wrapper = mountForm(); await wrapper.get('input[type=text]').setValue('   ');
      await wrapper.findAll('button').find(b => b.text() === 'Save & Add Another')!.trigger('click');
      expect(wrapper.emitted('save-and-add')).toBeUndefined();
    });
    it('submits via the form and preserves the entered name', async () => {
      const wrapper = mountForm(); await wrapper.get('input[type=text]').setValue('Romaine'); await wrapper.get('form').trigger('submit');
      expect((wrapper.emitted('save')![0][0] as {name:string}).name).toBe('Romaine');
    });
    it('keeps the original object untouched while editing', async () => {
      const wrapper = mountForm(true); await wrapper.get('input[type=text]').setValue('Edited');
      expect(fixtures[kind].name).not.toBe('Edited');
      await wrapper.get('form').trigger('submit'); expect((wrapper.emitted('save')![0][0] as {revision:number}).revision).toBe(1);
    });
    it('resets when closed and reopened as a new record', async () => {
      const wrapper = mountForm(true); await wrapper.setProps({ visible: false }); await wrapper.setProps({ [kind]: undefined, visible: true });
      expect((wrapper.get('input[type=text]').element as HTMLInputElement).value).toBe('');
      expect(wrapper.findAll('[aria-pressed=true]')).toHaveLength(0);
    });
    it('ignores submit while a save is already pending', async () => {
      const wrapper = mountForm(true, true); await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('save')).toBeUndefined(); expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined();
    });
    it('focuses the name on opening and traps Tab within the dialog', async () => {
      const wrapper = mountForm(); await flushPromises(); const name = wrapper.get('input[type=text]').element as HTMLInputElement;
      expect(document.activeElement).toBe(name); name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(wrapper.get('button[type=submit]').element);
    });
    it('Escape closes a clean form', async () => {
      const wrapper = mountForm(); await flushPromises(); await wrapper.get('input[type=text]').trigger('keydown', { key: 'Escape' }); expect(wrapper.emitted('close')).toHaveLength(1);
    });
    it('cancel protects unsaved changes until the user discards them', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); const wrapper = mountForm();
      await wrapper.get('input[type=text]').setValue('Unsaved'); const cancel = wrapper.findAll('button').find(b => b.text() === 'Cancel')!;
      await cancel.trigger('click'); expect(wrapper.emitted('close')).toBeUndefined(); expect(confirm).toHaveBeenCalledOnce();
      confirm.mockReturnValue(true); await cancel.trigger('click'); expect(wrapper.emitted('close')).toHaveLength(1);
    });
    it('clicking the backdrop does not silently discard input', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false); const wrapper = mountForm(); await wrapper.get('input[type=text]').setValue('Unsaved');
      await wrapper.get('.modal-overlay').trigger('click'); expect(wrapper.emitted('close')).toBeUndefined();
    });
  });
}

describe('Plant-specific details', () => {
  it('supports multiple sun choices without losing existing bits', async () => {
    const wrapper = mount(PlantForm, { props: { visible: true } });
    const full = wrapper.get('[title="Full Sun"]'); const shade = wrapper.get('[title="Shade"]'); await full.trigger('click'); await shade.trigger('click');
    await wrapper.get('input[type=text]').setValue('Mint'); await wrapper.get('form').trigger('submit'); expect((wrapper.emitted('save')![0][0] as {sun_requirements:number}).sun_requirements).toBe(5);
  });
  it('requires a second action before deleting a plant', async () => {
    const wrapper = mount(PlantForm, { props: { visible: true, plant: fixtures.plant as any } });
    await wrapper.findAll('button').find(b => b.text() === 'Delete')!.trigger('click'); expect(wrapper.emitted('delete')).toBeUndefined();
    await wrapper.findAll('button').find(b => b.text() === 'No')!.trigger('click'); expect(wrapper.emitted('delete')).toBeUndefined();
    await wrapper.findAll('button').find(b => b.text() === 'Delete')!.trigger('click'); await wrapper.findAll('button').find(b => b.text() === 'Yes, Delete')!.trigger('click'); expect(wrapper.emitted('delete')![0]).toEqual([8]);
  });
});
