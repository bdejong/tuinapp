import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SettingsView from '../../src/components/SettingsView.vue';
import { getBackupStatus, downloadBackup, type BackupStatus, type BackupEntry } from '../../src/api';
vi.mock('../../src/api',async original=>({ ...await original<typeof import('../../src/api')>(), getBackupStatus:vi.fn(),downloadBackup:vi.fn() }));
const saved: BackupEntry = {file:'tuinapp-one.json',created_at:'2026-01-02T10:00:00Z',reason:'scheduled',plants:177,activities:9,bytes:53248,uploaded_at:null};
const empty: BackupStatus = {latest:null,backups:[],last_error:null,last_checked_at:null,checked_unchanged:false,check_interval_seconds:300,offsite:null,storage:'r2'};
const history: BackupStatus = {...empty,latest:saved,backups:[saved],last_checked_at:new Date().toISOString()};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(getBackupStatus).mockResolvedValue(history);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('waits for history without claiming there are no backups',async()=>{
  vi.mocked(getBackupStatus).mockReturnValue(new Promise(()=>{}));const w=mount(SettingsView);
  expect(w.get('[role=status]').text()).toBe('Checking backups…');expect(w.text()).not.toContain('No saved backups');expect(w.find('table').exists()).toBe(false);
});
it('shows the empty state and R2 storage without browser restore controls',async()=>{
  vi.mocked(getBackupStatus).mockResolvedValue(empty);const w=mount(SettingsView);await flushPromises();
  expect(w.text()).toContain('No saved backups yet');expect(w.text()).toContain('automatically');expect(w.text()).toContain('Not yet');expect(w.text()).toContain('stored in Cloudflare R2');
  expect(w.find('input[type=file]').exists()).toBe(false);expect(w.find('input[type=checkbox]').exists()).toBe(false);expect(w.find('a').exists()).toBe(false);
  expect(w.text()).not.toMatch(/restore from|restore garden/i);
});
it('lists dates, counts, size and links to existing backups only',async()=>{
  const w=mount(SettingsView);await flushPromises();const row=w.get('tbody tr');
  expect(row.text()).toContain('177 plants · 9 activities');expect(row.text()).toContain('52 KB');
  expect(row.get('time').attributes('datetime')).toBe(saved.created_at);expect(row.get('a').attributes('href')).toBe('/api/backups/tuinapp-one.json/download');
  expect(row.get('a').attributes('aria-label')).toContain('Download backup from');expect(row.get('a').text()).toBe('Download backup');
});
it('shows pre-update safety copies and the count without exposing internal checksums',async()=>{
  vi.mocked(getBackupStatus).mockResolvedValue({...history,backups:[{...saved,file:'tuinapp-two.json',reason:'before-migration'},saved]});const w=mount(SettingsView);await flushPromises();
  expect(w.findAll('tbody tr')).toHaveLength(2);expect(w.get('h3').text()).toBe('Saved backups (2)');expect(w.text()).toContain('Before an update · safety copy');
});
it('uses the configured check interval and distinguishes a quiet garden from overdue backups',async()=>{
  vi.mocked(getBackupStatus).mockResolvedValue({...history,check_interval_seconds:600,checked_unchanged:true});const w=mount(SettingsView);await flushPromises();
  expect(w.text()).toContain('every 10 minutes');expect(w.text()).toContain('No changes since the last backup');expect(w.text()).not.toContain('overdue');
});
it('reports failed and overdue checks without claiming an unchanged check succeeded',async()=>{
  vi.mocked(getBackupStatus).mockResolvedValue({...history,last_error:'Disk full',last_checked_at:'2020-01-01T00:00:00Z',checked_unchanged:true});const w=mount(SettingsView);await flushPromises();
  expect(w.text()).toContain('Disk full');expect(w.text()).toContain('Backup checks are overdue');expect(w.text()).not.toContain('No changes since');
});
it('lists R2 backups without duplicate off-site status columns',async()=>{
  const w=mount(SettingsView);await flushPromises();expect(w.text()).toContain('stored in Cloudflare R2');expect(w.findAll('th').map(x=>x.text())).not.toContain('Off-site copy');
});
it('retries an initial history failure and removes the error',async()=>{
  vi.mocked(getBackupStatus).mockRejectedValueOnce(new Error('Unavailable'));const w=mount(SettingsView);await flushPromises();
  expect(w.get('[role=alert]').text()).toContain('Unavailable');expect(w.text()).not.toContain('No saved backups');await w.get('button').trigger('click');await flushPromises();expect(w.find('[role=alert]').exists()).toBe(false);expect(w.findAll('tbody tr')).toHaveLength(1);
});
it('retains the list with a stale warning if a periodic refresh fails',async()=>{
  vi.useFakeTimers();const w=mount(SettingsView);await flushPromises();vi.mocked(getBackupStatus).mockRejectedValueOnce(new Error('Offline'));await vi.advanceTimersByTimeAsync(60000);await flushPromises();
  expect(w.findAll('tbody tr')).toHaveLength(1);expect(w.get('[role=alert]').text()).toContain('may be out of date');w.unmount();
});
it('does not overlap refresh requests and stops polling on leaving Settings',async()=>{
  vi.useFakeTimers();vi.mocked(getBackupStatus).mockReturnValue(new Promise(()=>{}));const w=mount(SettingsView);await vi.advanceTimersByTimeAsync(180000);expect(getBackupStatus).toHaveBeenCalledOnce();w.unmount();await vi.advanceTimersByTimeAsync(60000);expect(getBackupStatus).toHaveBeenCalledOnce();
});
it('download errors are inline, keep the history and allow retry',async()=>{
  vi.mocked(downloadBackup).mockRejectedValue(new Error('This backup could not be verified'));const w=mount(SettingsView);await flushPromises();await w.get('a').trigger('click');await flushPromises();
  expect(w.get('[role=alert]').text()).toContain('could not be verified');expect(w.findAll('tbody tr')).toHaveLength(1);expect(w.get('a').attributes('aria-disabled')).toBeUndefined();expect(getBackupStatus).toHaveBeenCalledOnce();
});
it('downloads the selected saved version once and releases its object URL',async()=>{
  vi.useFakeTimers();let finish!:(b:Blob)=>void;vi.mocked(downloadBackup).mockReturnValue(new Promise(r=>finish=r));
  const create=vi.fn(()=> 'blob:backup');const revoke=vi.fn();vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  const w=mount(SettingsView);await flushPromises();await w.get('a').trigger('click');await w.get('a').trigger('click');
  expect(downloadBackup).toHaveBeenCalledExactlyOnceWith(saved.file);expect(w.get('a').text()).toBe('Downloading…');expect(w.get('a').attributes('aria-disabled')).toBe('true');
  finish(new Blob(['JSON']));await flushPromises();expect(click).toHaveBeenCalledOnce();expect(create).toHaveBeenCalledOnce();expect(w.get('a').text()).toBe('Download backup');
  await vi.advanceTimersByTimeAsync(1000);expect(revoke).toHaveBeenCalledWith('blob:backup');expect(getBackupStatus).toHaveBeenCalledOnce();w.unmount();
});
it('does not start a download after leaving Settings while the file was loading',async()=>{
  let finish!:(b:Blob)=>void;vi.mocked(downloadBackup).mockReturnValue(new Promise(r=>finish=r));const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});const w=mount(SettingsView);await flushPromises();await w.get('a').trigger('click');w.unmount();finish(new Blob(['ZIP']));await flushPromises();expect(click).not.toHaveBeenCalled();
});
it('keeps the settings page download-only with no file chooser or destructive action',async()=>{
  const w=mount(SettingsView);await flushPromises();
  expect(w.find('input[type=file]').exists()).toBe(false);expect(w.find('input[type=checkbox]').exists()).toBe(false);
  expect(w.findAll('button').map(button=>button.text())).not.toContain('Restore garden');
  expect(w.text()).not.toMatch(/restore from a sql dump|replaces the current garden/i);
});
