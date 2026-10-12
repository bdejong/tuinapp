import { it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import PlantGrid from '../../src/components/PlantGrid.vue';
import { getAllPlants } from '../../src/api';
vi.mock('../../src/api');
afterEach(()=>vi.useRealTimers());
const plants=[
  {id:1,name:'Blank',sun_requirements:0,sow_periods:0,plant_periods:0,needs_reorder:false},
  {id:2,name:'Sow',sun_requirements:0,sow_periods:0xffffff,plant_periods:0,needs_reorder:false},
  {id:3,name:'Plant',sun_requirements:0,sow_periods:0,plant_periods:0xffffff,needs_reorder:false},
  {id:4,name:'Both',sun_requirements:0,sow_periods:0xffffff,plant_periods:0xffffff,needs_reorder:false},
];
it.each([
  [2026,0,1,0,'Early January'],[2026,9,15,18,'Early October'],[2026,9,16,19,'Late October'],
  [2026,11,31,23,'Late December'],[2028,1,29,3,'Late February'],
])('highlights only the correct half-month on %i/%i/%i',async(year,month,day,index,label)=>{
  vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime(new Date(year as number,month as number,day as number,12));
  vi.mocked(getAllPlants).mockResolvedValue(plants);
  const w=mount(PlantGrid);await flushPromises();
  expect(w.findAll('th[aria-current=date]')).toHaveLength(1);
  expect(w.get('th[aria-current=date]').attributes('aria-label')).toBe(`${label}, current period`);
  for(const row of w.findAll('tbody tr')) {
    expect(row.findAll('.current-period')).toHaveLength(1);
    expect(row.findAll('.period-cell')[index as number].classes()).toContain('current-period');
  }
  expect(w.findAll('tbody .current-period').map(cell=>cell.text())).toEqual(['','S','P','S/P']);
  w.unmount();expect(vi.getTimerCount()).toBe(0);
});
it.each([[2026,9,15,'Early October','Late October'],[2026,11,31,'Late December','Early January']])('updates an open overview at midnight on %i/%i/%i',async(year,month,day,before,after)=>{
  vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime(new Date(year as number,month as number,day as number,23,59,59));
  vi.mocked(getAllPlants).mockResolvedValue(plants);
  const w=mount(PlantGrid);await flushPromises();
  expect(w.get('th[aria-current=date]').attributes('aria-label')).toBe(`${before}, current period`);
  await vi.advanceTimersByTimeAsync(1000);
  expect(w.get('th[aria-current=date]').attributes('aria-label')).toBe(`${after}, current period`);
  w.unmount();expect(vi.getTimerCount()).toBe(0);
});

it.each([0,9,11])('filters overlapping actions in either half of month %i and can restore all plants',async month=>{
  vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime(new Date(2026,month,20,12));
  const early=1<<(month*2),late=early<<1,other=1<<(((month+1)%12)*2);
  const make=(name:string,sow:number,plant:number,id:number)=>({...plants[0],id,name,sow_periods:sow,plant_periods:plant});
  vi.mocked(getAllPlants).mockResolvedValue([
    make('A: early sow',early,0,1),make('B: late sow',late,0,2),make('C: early plant',0,early,3),
    make('D: late plant',0,late,4),make('E: both actions',early|late,early|late,5),
    make('F: another month',other,other,6),make('G: no actions',0,0,7),
  ]);
  const w=mount(PlantGrid);await flushPromises();expect(w.findAll('tbody tr')).toHaveLength(7);
  await w.get('select').setValue('month');
  expect(w.findAll('tbody .row-name').map(b=>b.text())).toEqual(['A: early sow','B: late sow','C: early plant','D: late plant','E: both actions']);
  expect(w.text()).toContain('5 of 7 plants');
  await w.get('select').setValue('all');expect(w.findAll('tbody tr')).toHaveLength(7);
  w.unmount();
});
it('explains an empty month without claiming the garden is empty',async()=>{
  vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime(new Date(2026,9,12));
  vi.mocked(getAllPlants).mockResolvedValue([plants[0]]);
  const w=mount(PlantGrid);await flushPromises();await w.get('select').setValue('month');
  expect(w.text()).toContain('No sowing or planting planned in October.');expect(w.text()).not.toContain('No plants yet');
  expect(w.get('select').exists()).toBe(true);
  await w.get('select').setValue('all');expect(w.findAll('tbody tr')).toHaveLength(1);w.unmount();
});
it('the active-month filter updates across the year boundary while open',async()=>{
  vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});vi.setSystemTime(new Date(2026,11,31,23,59,59));
  vi.mocked(getAllPlants).mockResolvedValue([
    {...plants[0],name:'December',sow_periods:1<<23}, {...plants[1],name:'January',sow_periods:1},
  ]);
  const w=mount(PlantGrid);await flushPromises();await w.get('select').setValue('month');
  expect(w.findAll('tbody .row-name').map(b=>b.text())).toEqual(['December']);
  await vi.advanceTimersByTimeAsync(1000);
  expect(w.get('option[value=month]').text()).toBe('Active in January');
  expect(w.findAll('tbody .row-name').map(b=>b.text())).toEqual(['January']);w.unmount();
});
