import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ActivityList from '../../src/components/ActivityList.vue';
import { getAllActivities } from '../../src/api';
import type { Activity } from '../../src/types';

vi.mock('../../src/api');

const activity = (id: number, name: string, active_periods: number, description = ''): Activity => ({
  id, name, active_periods, description, revision: 1,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(2026, 9, 13, 12));
  vi.mocked(getAllActivities).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('activity month sections', () => {
  it('shows twelve cyclic month sections, repeats each scheduled activity once per active month, and keeps unscheduled activities at the bottom', async () => {
    vi.mocked(getAllActivities).mockResolvedValue([
      activity(1, 'January task', 1 << 0),
      activity(2, 'October task', 1 << 19),
      activity(3, 'Both November halves', 3 << 20),
      activity(4, 'Every month', 0xffffff),
      activity(5, 'No schedule', 0),
    ]);
    const wrapper = mount(ActivityList);
    await flushPromises();

    const sections = wrapper.findAll('.month-section:not([data-unscheduled])');
    expect(sections).toHaveLength(12);
    expect(sections.map(section => section.find('h2').text().replace('Current month', '').trim())).toEqual([
      'October', 'November', 'December', 'January', 'February', 'March',
      'April', 'May', 'June', 'July', 'August', 'September',
    ]);
    expect(wrapper.findAll('[aria-current="date"].current-badge')).toHaveLength(1);
    expect(sections[0].find('h2').classes()).toContain('current-month');

    const section = (index: number) => wrapper.get(`.month-section[data-month-index="${index}"]`);
    expect(section(9).findAll('.row-name').map(button => button.text())).toContain('October task');
    expect(section(10).findAll('.row-name').filter(button => button.text() === 'Both November halves')).toHaveLength(1);
    expect(section(0).findAll('.row-name').map(button => button.text())).toContain('January task');
    for (let index = 0; index < 12; index++) {
      expect(section(index).findAll('.row-name').filter(button => button.text() === 'Every month')).toHaveLength(1);
      expect(section(index).findAll('.row-name').some(button => button.text() === 'No schedule')).toBe(false);
    }
    expect(wrapper.get('[data-unscheduled]').findAll('.row-name').map(button => button.text())).toEqual(['No schedule']);
    expect(wrapper.get('[data-unscheduled]').element).toBe(wrapper.findAll('.month-section').at(-1)?.element);
    wrapper.unmount();
  });

  it('reorders months on rollover and when the tab returns to the foreground', async () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 59));
    vi.mocked(getAllActivities).mockResolvedValue([activity(1, 'October', 1 << 18)]);
    const wrapper = mount(ActivityList);
    await flushPromises();
    expect(wrapper.find('.month-section h2')?.text()).toContain('October');

    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.find('.month-section h2')?.text()).toContain('November');

    vi.setSystemTime(new Date(2027, 0, 3, 9));
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(wrapper.find('.month-section h2')?.text()).toContain('January');
    wrapper.unmount();
  });

  it('keeps its refresh timer within one day early in the year', async () => {
    vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
    vi.mocked(getAllActivities).mockResolvedValue([activity(1, 'January task', 1)]);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const wrapper = mount(ActivityList);
    await flushPromises();

    const delay = Number(timeout.mock.calls[0][1]);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    wrapper.unmount();
  });

  it('moves an edited activity into its new month section and retains its description', async () => {
    const api = await import('../../src/api');
    const before = activity(1, 'Prune', 1, 'Keep this note');
    const after = { ...before, active_periods: 1 << 23 };
    vi.mocked(getAllActivities).mockResolvedValueOnce([before]).mockResolvedValue([after]);
    vi.mocked(api.updateActivity).mockResolvedValue(after);
    const wrapper = mount(ActivityList);
    await flushPromises();

    await wrapper.get('.month-section[data-month-index="0"] .row-name').trigger('click');
    await wrapper.get('[aria-label="Active Periods: early January"]').trigger('click');
    await wrapper.get('[aria-label="Active Periods: late December"]').trigger('click');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.updateActivity).toHaveBeenCalledWith(expect.objectContaining({ active_periods: 1 << 23, description: 'Keep this note' }));
    expect(wrapper.get('.month-section[data-month-index="11"] .row-name').text()).toBe('Prune');
    expect(wrapper.get('.month-section[data-month-index="11"] td[data-label="Description"]').text()).toBe('Keep this note');
    expect(wrapper.get('.month-section[data-month-index="0"] .month-empty').text()).toBe('No activities scheduled.');
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
    wrapper.unmount();
  });
});
