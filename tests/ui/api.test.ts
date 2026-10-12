import { it, expect, vi, afterEach } from 'vitest';
import { login, checkSession, getAllPlants, createPlant, deletePlant, logout, getMonthPdf } from '../../src/api';
afterEach(()=>vi.unstubAllGlobals());
it('adds the session CSRF token to writes and keeps credentials same-origin',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({csrf_token:'token'}))).mockResolvedValueOnce(new Response(JSON.stringify({id:1})));
  vi.stubGlobal('fetch',fetch);await login('password');await createPlant({name:'A',sun_requirements:0,sow_periods:0,plant_periods:0,needs_reorder:false});
  const [url,options]=fetch.mock.calls[1];expect(url).toBe('/api/plants');expect(options.credentials).toBe('same-origin');expect(options.headers['X-CSRF-Token']).toBe('token');expect(options.headers['X-Tuinapp-Request']).toBe('1');
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

it('fetches printable PDF bytes for the selected month with the owner session',async()=>{
  const blob=new Blob(['%PDF-1.3'],{type:'application/pdf'});
  const fetch=vi.fn().mockResolvedValue({ok:true,status:200,blob:async()=>blob});vi.stubGlobal('fetch',fetch);
  expect(await getMonthPdf(10)).toBe(blob);expect(fetch.mock.calls[0][0]).toBe('/api/months/10/pdf');
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
