import { it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ActivityList from '../../src/components/ActivityList.vue';
import { getAllActivities } from '../../src/api';
import { MONTHS } from '../../src/types';
vi.mock('../../src/api');
it.each(MONTHS.map((month,index)=>[month,index] as const))('shows %s once for early, late or both halves',async(month,index)=>{
  vi.mocked(getAllActivities).mockResolvedValue([1,2,3].map((half,id)=>({id,name:`Activity ${id}`,active_periods:half<<(index*2)})));
  const w=mount(ActivityList);await flushPromises();
  expect(w.findAll('.activity-months').map(c=>c.text())).toEqual([month,month,month]);
});
it.each([
  [3|(2<<10)|(1<<22),'January, June, December'],[0xffffff,'Every month'],[0,'Not scheduled'],
])('clearly describes a schedule with mask %i',async(mask,label)=>{
  vi.mocked(getAllActivities).mockResolvedValue([{id:1,name:'Prune',active_periods:mask as number}]);
  const w=mount(ActivityList);await flushPromises();expect(w.get('.activity-months').text()).toBe(label);
});
it('updates the months after editing an activity without losing its description',async()=>{
  const api=await import('../../src/api');
  const before={id:1,name:'Prune',description:'Keep this note',active_periods:1};
  vi.mocked(getAllActivities).mockResolvedValueOnce([before]).mockResolvedValue([{...before,active_periods:1<<23}]);
  vi.mocked(api.updateActivity).mockResolvedValue({...before,active_periods:1<<23});
  const w=mount(ActivityList);await flushPromises();await w.get('.row-name').trigger('click');
  await w.get('[aria-label="Active Periods: early January"]').trigger('click');
  await w.get('[aria-label="Active Periods: late December"]').trigger('click');
  await w.get('form').trigger('submit');await flushPromises();
  expect(api.updateActivity).toHaveBeenCalledWith(expect.objectContaining({active_periods:1<<23,description:'Keep this note'}));
  expect(w.get('.activity-months').text()).toBe('December');expect(w.find('[role=dialog]').exists()).toBe(false);
});
