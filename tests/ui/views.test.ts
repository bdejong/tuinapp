import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import * as api from '../../src/api';
import PlantList from '../../src/components/PlantList.vue';
import ActivityList from '../../src/components/ActivityList.vue';
import PlantGrid from '../../src/components/PlantGrid.vue';
import MonthlyView from '../../src/components/MonthlyView.vue';
import ToOrderView from '../../src/components/ToOrderView.vue';
import SettingsView from '../../src/components/SettingsView.vue';
import LoginView from '../../src/components/LoginView.vue';
vi.mock('../../src/api');
const plant = {id:1,name:'Basil',sun_requirements:3,sow_periods:1,plant_periods:8388608,needs_reorder:true,revision:1};
const activity = {id:2,name:'Prune',active_periods:1,description:'After frost',revision:1};
const status: api.BackupStatus = {latest:null,backups:[],last_error:null,last_checked_at:null,checked_unchanged:false,check_interval_seconds:300,offsite:null};
const button = (wrapper:any,name:string) => wrapper.findAll('button').find((b:any)=>b.text()===name)!;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getAllPlants).mockResolvedValue([plant]); vi.mocked(api.getAllActivities).mockResolvedValue([activity]);
  vi.mocked(api.getPlantsToReorder).mockResolvedValue([plant]);
  vi.mocked(api.getMonthData).mockResolvedValue({sow_early:[plant],sow_late:[],plant_early:[],plant_late:[],activities:[activity]});
  vi.mocked(api.getBackupStatus).mockResolvedValue(status);
});

for (const [name,Component,getter] of [['plants',PlantList,'getAllPlants'],['activities',ActivityList,'getAllActivities'],['overview',PlantGrid,'getAllPlants'],['order list',ToOrderView,'getPlantsToReorder']] as const) {
  describe(name, () => {
    it('shows loading instead of an empty garden while waiting', async () => {
      vi.mocked(api[getter]).mockReturnValue(new Promise(()=>{})); const wrapper=mount(Component as any);
      expect(wrapper.get('[role=status]').text()).toContain('Loading'); expect(wrapper.text()).not.toContain('No plants yet');
    });
    it('distinguishes a failed load from empty data and supports retry', async () => {
      vi.mocked(api[getter]).mockRejectedValueOnce(new Error('Offline')); const wrapper=mount(Component as any);await flushPromises();
      expect(wrapper.get('[role=alert]').text()).toContain('Offline');await button(wrapper,'Try again').trigger('click');await flushPromises();
      expect(wrapper.find('[role=alert]').exists()).toBe(false);expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });
    it('renders a meaningful empty state', async () => {
      vi.mocked(api[getter]).mockResolvedValue([]);const wrapper=mount(Component as any);await flushPromises();
      expect(wrapper.text()).toMatch(/No (plants|activities|seeds)/);expect(wrapper.find('table').exists()).toBe(false);
    });
  });
}

describe('Plant list behavior', () => {
  it('search ignores case and outer whitespace and has a no-match message', async () => {
    const w=mount(PlantList);await flushPromises();await w.get('[aria-label="Search plants"]').setValue('  BASIL  ');expect(w.findAll('tbody tr')).toHaveLength(1);
    await w.get('input').setValue('tomato');expect(w.text()).toContain('No plants match');await w.get('input').setValue('');expect(w.findAll('tbody tr')).toHaveLength(1);
  });
  it('has no photo column or photo controls when editing a plant', async () => {
    const w=mount(PlantList);await flushPromises();
    expect(w.findAll('th').map(h=>h.text())).toEqual(['Name','Type','Sun']);
    await button(w,'Basil').trigger('click');
    expect(w.text()).not.toMatch(/photo|camera|upload/i);
    expect(w.find('input[type=file]').exists()).toBe(false);
  });
  it('failed saves leave the form and input intact', async () => {
    vi.mocked(api.createPlant).mockRejectedValue(new Error('Offline'));const w=mount(PlantList);await flushPromises();await button(w,'+ Add Plant').trigger('click');
    await w.get('[role=dialog] input[type=text]').setValue('Unsaved');await w.get('form').trigger('submit');await flushPromises();
    expect(w.get('[role=dialog] input[type=text]').element).toHaveProperty('value','Unsaved');
  });
  it('suppresses double submission during a slow save', async () => {
    let resolve!:(p:any)=>void;vi.mocked(api.createPlant).mockReturnValue(new Promise(r=>resolve=r));const w=mount(PlantList);await flushPromises();await button(w,'+ Add Plant').trigger('click');
    await w.get('[role=dialog] input[type=text]').setValue('One plant');await w.get('form').trigger('submit');await w.get('form').trigger('submit');expect(api.createPlant).toHaveBeenCalledTimes(1);
    resolve(plant);await flushPromises();expect(w.find('[role=dialog]').exists()).toBe(false);
  });
  it('a successful save followed by a failed refresh cannot be accidentally saved twice', async () => {
    vi.mocked(api.createPlant).mockResolvedValue(plant);const w=mount(PlantList);await flushPromises();await button(w,'+ Add Plant').trigger('click');
    await w.get('[role=dialog] input[type=text]').setValue('Saved once');vi.mocked(api.getAllPlants).mockRejectedValueOnce(new Error('Refresh failed'));
    await w.get('form').trigger('submit');await flushPromises();expect(w.find('[role=dialog]').exists()).toBe(false);expect(w.text()).toContain('Refresh failed');expect(api.createPlant).toHaveBeenCalledTimes(1);
  });
  it('Save and Add Another resets all plant fields', async () => {
    vi.mocked(api.createPlant).mockResolvedValue(plant);const w=mount(PlantList);await flushPromises();await button(w,'+ Add Plant').trigger('click');
    await w.get('[role=dialog] input[type=text]').setValue('First');await w.get('button[title="Full Sun"]').trigger('click');await button(w,'Save & Add Another').trigger('click');await flushPromises();
    expect(w.get('[role=dialog] input[type=text]').element).toHaveProperty('value','');expect(w.findAll('[role=dialog] [aria-pressed=true]')).toHaveLength(0);
  });
});

describe('Activities and reorder', () => {
  it('Save and Add Another also resets activity details', async () => {
    vi.mocked(api.createActivity).mockResolvedValue(activity);const w=mount(ActivityList);await flushPromises();await button(w,'+ Add Activity').trigger('click');
    await w.get('input').setValue('First');await w.get('textarea').setValue('Notes');await button(w,'Save & Add Another').trigger('click');await flushPromises();expect(w.get('input').element).toHaveProperty('value','');expect(w.get('textarea').element).toHaveProperty('value','');
  });
  it('activity delete cancellation preserves the record', async () => {
    vi.spyOn(window,'confirm').mockReturnValue(false);const w=mount(ActivityList);await flushPromises();await button(w,'Prune').trigger('click');await button(w,'Delete').trigger('click');expect(api.deleteActivity).not.toHaveBeenCalled();
  });
  it('reorder writes only the reorder action and leaves the row on failure', async () => {
    vi.mocked(api.markOrdered).mockRejectedValue(new Error('Offline'));const w=mount(ToOrderView);await flushPromises();await button(w,'Ordered').trigger('click');await flushPromises();expect(api.markOrdered).toHaveBeenCalledWith(plant);expect(api.updatePlant).not.toHaveBeenCalled();expect(w.findAll('tbody tr')).toHaveLength(1);
  });
  it('reorder shows the empty state after the last item is ordered', async () => {
    vi.mocked(api.markOrdered).mockResolvedValue({...plant,needs_reorder:false});const w=mount(ToOrderView);await flushPromises();vi.mocked(api.getPlantsToReorder).mockResolvedValue([]);await button(w,'Ordered').trigger('click');await flushPromises();expect(w.text()).toContain('No seeds need');
  });
});

describe('Monthly calendar', () => {
  it('includes uncategorized plants, notes, sun choices and activity descriptions', async () => {
    const w=mount(MonthlyView);await flushPromises();expect(w.text()).toContain('Other');expect(w.text()).toContain('Basil');expect(w.text()).toContain('Sun, Partial shade');expect(w.text()).toContain('After frost');
  });
  it('cannot print a month whose data is still loading', () => {
    vi.mocked(api.getMonthData).mockReturnValue(new Promise(()=>{}));const w=mount(MonthlyView);expect(button(w,'Printable PDF').attributes('disabled')).toBeDefined();
  });
  it('downloads the selected month as a PDF and releases the download URL', async () => {
    vi.useFakeTimers();
    const blob = new Blob(['%PDF-1.3'], {type:'application/pdf'});
    vi.mocked(api.getMonthPdf).mockResolvedValue(blob);
    const create = vi.fn().mockReturnValue('blob:print-test'); const revoke = vi.fn();
    vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));
    let filename = ''; let href = '';
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){filename=this.download;href=this.href;});
    const browserPrint=vi.spyOn(window,'print').mockImplementation(()=>{});
    try {
      const w=mount(MonthlyView);await flushPromises();await w.get('select').setValue('4');await flushPromises();
      await button(w,'Printable PDF').trigger('click');await flushPromises();
      expect(api.getMonthPdf).toHaveBeenCalledWith(4);expect(create).toHaveBeenCalledWith(blob);
      expect(filename).toBe('garden-planner-april.pdf');expect(href).toBe('blob:print-test');
      expect(browserPrint).not.toHaveBeenCalled();expect(document.querySelector('a[download]')).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);expect(revoke).toHaveBeenCalledWith('blob:print-test');
    } finally {vi.useRealTimers();vi.unstubAllGlobals();}
  });
  it('blocks duplicate exports and month changes while generating', async () => {
    let fail!:(reason:Error)=>void;
    vi.mocked(api.getMonthPdf).mockReturnValue(new Promise((_,reject)=>fail=reject));
    const w=mount(MonthlyView);await flushPromises();const exportButton=button(w,'Printable PDF');
    await exportButton.trigger('click');await exportButton.trigger('click');
    expect(api.getMonthPdf).toHaveBeenCalledOnce();expect(w.get('select').attributes('disabled')).toBeDefined();
    expect(button(w,'Preparing PDF…').attributes('disabled')).toBeDefined();expect(w.get('[role=status]').text()).toContain('Preparing');
    fail(new Error('Offline'));await flushPromises();expect(w.get('select').attributes('disabled')).toBeUndefined();
    expect(button(w,'Printable PDF').attributes('disabled')).toBeUndefined();
  });
  it('retains the calendar after a failed PDF and offers retry', async () => {
    vi.mocked(api.getMonthPdf).mockRejectedValueOnce(new Error('PDF unavailable')).mockRejectedValueOnce(new Error('Try later'));
    const w=mount(MonthlyView);await flushPromises();await button(w,'Printable PDF').trigger('click');await flushPromises();
    expect(w.get('[role=alert]').text()).toContain('PDF unavailable');expect(w.text()).toContain('Basil');
    await button(w,'Retry PDF').trigger('click');await flushPromises();expect(api.getMonthPdf).toHaveBeenCalledTimes(2);
    expect(w.get('[role=alert]').text()).toContain('Try later');
    await w.get('select').setValue('2');await flushPromises();expect(w.find('[role=alert]').exists()).toBe(false);
  });
  it('ignores an older response when months change quickly', async () => {
    let finish!:(data:any)=>void;vi.mocked(api.getMonthData).mockReturnValueOnce(new Promise(r=>finish=r));const w=mount(MonthlyView);
    await w.get('select').setValue('2');await flushPromises();finish({sow_early:[{...plant,name:'Stale plant'}],sow_late:[],plant_early:[],plant_late:[],activities:[]});await flushPromises();expect(w.text()).not.toContain('Stale plant');expect(w.text()).toContain('February in the garden');
  });
  it('offers retry after a failed request', async () => {
    vi.mocked(api.getMonthData).mockRejectedValueOnce(new Error('Calendar unavailable'));const w=mount(MonthlyView);await flushPromises();expect(w.text()).toContain('Calendar unavailable');await button(w,'Try again').trigger('click');await flushPromises();expect(w.text()).toContain('Basil');
  });
});

describe('Settings and login', () => {
  it('login failure is visible and does not lose the entered password', async () => {
    vi.mocked(api.login).mockRejectedValue(new Error('Incorrect password'));const w=mount(LoginView);await w.get('input').setValue('wrong');await w.get('form').trigger('submit');await flushPromises();expect(w.get('[role=alert]').text()).toBe('Incorrect password');expect(w.get('input').element).toHaveProperty('value','wrong');expect(w.emitted('signedIn')).toBeUndefined();
  });
  it('successful login clears the password and opens the garden', async () => {
    vi.mocked(api.login).mockResolvedValue();const w=mount(LoginView);await w.get('input').setValue('correct');await w.get('form').trigger('submit');await flushPromises();expect(w.get('input').element).toHaveProperty('value','');expect(w.emitted('signedIn')).toHaveLength(1);
  });
});

it('a slow login accepts just one submission and emits sign-in once', async () => {
  let finish!:()=>void;vi.mocked(api.login).mockReturnValue(new Promise(resolve=>finish=resolve));
  const w=mount(LoginView);await w.get('input').setValue('correct');
  await w.get('form').trigger('submit');await w.get('form').trigger('submit');
  expect(api.login).toHaveBeenCalledOnce();expect(w.get('button').attributes('disabled')).toBeDefined();
  finish();await flushPromises();expect(w.emitted('signedIn')).toHaveLength(1);
});
