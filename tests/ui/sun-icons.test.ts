import { it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { vi } from 'vitest';
import PlantForm from '../../src/components/PlantForm.vue';
import PlantList from '../../src/components/PlantList.vue';
import { getAllPlants } from '../../src/api';
vi.mock('../../src/api');
const choices=[['Full Sun','full-sun',1],['Half Sun','half-sun',2],['Shade','shade',4]] as const;
it.each(Array.from({length:8},(_,i)=>i))('renders the correct PDF symbols for sun mask %i',async mask=>{
  vi.mocked(getAllPlants).mockResolvedValue([{id:1,name:'Mint',sun_requirements:mask,sow_periods:0,plant_periods:0,needs_reorder:false}]);
  const wrapper=mount(PlantList);await flushPromises();
  expect(wrapper.findAll('.sun-icon').map(i=>[i.attributes('alt'),i.attributes('src')])).toEqual(choices.filter(c=>mask & c[2]).map(c=>[c[0],`/icons/${c[1]}.svg`]));
  if(!mask)expect(wrapper.find('[aria-label="Sun requirement not specified"]').exists()).toBe(true);
});
it('uses the same symbols in the form with clear labels and keyboard button states',async()=>{
  const wrapper=mount(PlantForm,{props:{visible:true}});
  await wrapper.get('input[type=text]').setValue('Mint');
  for (const [label,file] of choices) {
    const choice=wrapper.get(`button[title="${label}"]`);
    expect(choice.get('img').attributes('src')).toBe(`/icons/${file}.svg`);
    expect(choice.get('img').attributes('alt')).toBe('');
    expect(choice.text()).toBe(label);
    await choice.trigger('click');expect(choice.attributes('aria-pressed')).toBe('true');
  }
  await wrapper.get('form').trigger('submit');expect((wrapper.emitted('save')![0][0] as any).sun_requirements).toBe(7);
  await wrapper.get('button[title="Half Sun"]').trigger('click');
  await wrapper.get('form').trigger('submit');expect((wrapper.emitted('save')![1][0] as any).sun_requirements).toBe(5);
});

it.each(['full-sun','half-sun','shade'])('the colored %s asset keeps the exact PDF icon geometry',async name=>{
  const {readFileSync}=await import('node:fs');
  const read=(folder:string)=>new DOMParser().parseFromString(readFileSync(`public/${folder}/${name}.svg`,'utf8'),'image/svg+xml');
  const geometry=(doc:Document)=>Array.from(doc.querySelectorAll('svg,g,path,circle')).map(el=>[el.tagName,...Array.from(el.attributes).filter(a=>!['fill','stroke'].includes(a.name)).map(a=>[a.name,a.value])]);
  const color=read('icons'),print=read('print-icons');
  expect(geometry(color)).toEqual(geometry(print));
  if(name!=='shade')expect(color.querySelector('circle')?.getAttribute('fill')).toBe('#f6c744');
  if(name!=='full-sun')expect(color.querySelector('path[fill]')?.getAttribute('fill')).toBe('#cbd0d6');
  expect(print.querySelector('g')?.getAttribute('stroke')).toBe('black');
});
