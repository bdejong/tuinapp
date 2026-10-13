import { it, expect, vi, afterEach } from 'vitest';
import { login, checkSession, getAllPlants, createPlant, deletePlant, logout, getMonthPdf } from '../../src/api';
afterEach(()=>vi.unstubAllGlobals());
it('adds the session CSRF token to writes and keeps credentials same-origin',async()=>{
  const salt=btoa(String.fromCharCode(...new Uint8Array(16)));
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({version:1,algorithm:'PBKDF2-SHA-256',salt,iterations:600000}))).mockResolvedValueOnce(new Response(JSON.stringify({csrf_token:'token'}))).mockResolvedValueOnce(new Response(JSON.stringify({id:1})));
  vi.stubGlobal('fetch',fetch);await login('password');await createPlant({name:'A',sun_requirements:0,sow_periods:0,plant_periods:0,needs_reorder:false});
  expect(fetch.mock.calls[0][0]).toBe('/api/login-parameters');
  const loginOptions=fetch.mock.calls[1][1];expect(fetch.mock.calls[1][0]).toBe('/api/login');expect(JSON.parse(loginOptions.body)).not.toHaveProperty('password');expect(JSON.parse(loginOptions.body).proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const [url,options]=fetch.mock.calls[2];expect(url).toBe('/api/plants');expect(options.credentials).toBe('same-origin');expect(options.headers['X-CSRF-Token']).toBe('token');expect(options.headers['X-Tuinapp-Request']).toBe('1');
});
it('handles an empty successful delete response',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:204})));await expect(deletePlant(1,2)).resolves.toBeUndefined();
});
it('a failed HTTP operation raises a visible error event',async()=>{
  const event=vi.fn();window.addEventListener('api-error',event);vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Useful error'}),{status:400})));
  await expect(deletePlant(1,1)).rejects.toThrow('Useful error');expect(event).toHaveBeenCalledOnce();window.removeEventListener('api-error',event);
});
it('network failure preserves the error for the caller and the interface',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Connection lost')));await expect(getAllPlants()).rejects.toThrow('Connection lost');
});
it('expired sessions ask for sign-in instead of treating data as empty',async()=>{
  const event=vi.fn();window.addEventListener('session-expired',event);vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));await expect(getAllPlants()).rejects.toThrow();expect(event).toHaveBeenCalledOnce();window.removeEventListener('session-expired',event);
});
it('initial session checks do not flash a global error for signed-out users',async()=>{
  const event=vi.fn();window.addEventListener('api-error',event);vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));await expect(checkSession()).rejects.toThrow();expect(event).not.toHaveBeenCalled();window.removeEventListener('api-error',event);
});
it('logout uses a protected DELETE and accepts an empty response',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',fetch);await logout();expect(fetch.mock.calls[0][1].method).toBe('DELETE');
});

it('fetches selected-month data and renders printable PDF bytes locally',async()=>{
  const data={sow_early:[],sow_late:[],plant_early:[],plant_late:[],activities:[]};
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));vi.stubGlobal('fetch',fetch);
  const blob=await getMonthPdf(10);expect(blob.type).toBe('application/pdf');expect(blob.size).toBeGreaterThan(20);
  expect(fetch.mock.calls[0][0]).toBe('/api/months/10/pdf-data');
  expect(fetch.mock.calls[0][1].credentials).toBe('same-origin');expect(fetch.mock.calls[0][1].method).toBe('GET');
});

it('read failures are handled inline without a duplicate global banner',async()=>{
  const event=vi.fn();window.addEventListener('api-error',event);
  try {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Offline'}),{status:503})));
    await expect(getAllPlants()).rejects.toThrow('Offline');expect(event).not.toHaveBeenCalled();
  } finally {window.removeEventListener('api-error',event);}
});
it('an expired write opens sign-in without also showing a global error',async()=>{
  const error=vi.fn();const expired=vi.fn();window.addEventListener('api-error',error);window.addEventListener('session-expired',expired);
  try {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
    await expect(deletePlant(1,1)).rejects.toThrow();expect(expired).toHaveBeenCalledOnce();expect(error).not.toHaveBeenCalled();
  } finally {window.removeEventListener('api-error',error);window.removeEventListener('session-expired',expired);}
});

it('backup downloads use the selected filename and report failure inline',async()=>{
  const {downloadBackup}=await import('../../src/api');const event=vi.fn();window.addEventListener('api-error',event);
  try {
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Unavailable'}),{status:503}));vi.stubGlobal('fetch',fetch);
    await expect(downloadBackup('a b.sql')).rejects.toThrow('Unavailable');expect(fetch.mock.calls[0][0]).toBe('/api/backups/a%20b.sql/download');expect(event).not.toHaveBeenCalled();
  } finally {window.removeEventListener('api-error',event);}
});

it('does not expose a browser backup restore client operation',async()=>{
  const api=await import('../../src/api');expect('restoreBackup' in api).toBe(false);
});
