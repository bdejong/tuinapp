// Exercises the built image using disposable, uniquely named Docker volumes only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.argv[2] || 'tuinapp:test';
const name = `tuinapp-smoke-${randomUUID()}`;
const data = `${name}-data`, backups = `${name}-backups`;
const password = `container-test-${randomUUID()}`;
const env = { ...process.env };
const run = (args, options = {}) => {
  const result = spawnSync('docker', args, { env, encoding:'utf8', timeout:120000, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Docker command failed');
  return result.stdout.trim();
};
let containerCreated = false;
let importerCreated = false;
const importer = `${name}-import`;
const source = process.env.TUINAPP_GOLDEN_DB;
const hash = () => source ? createHash('sha256').update(readFileSync(source)).digest('hex') : '';
const originalHash = hash();
const volumes = [];
let base, cookie, csrf;
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method, signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json', 'X-Tuinapp-Request':'1', ...(cookie ? {Cookie:cookie,'X-CSRF-Token':csrf} : {})},
    body:body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}
async function signIn() {
  const response = await request('/api/login','POST',{password});
  assert.equal(response.status,200);
  cookie = response.headers.getSetCookie()[0].split(';')[0];
  csrf = (await response.json()).csrf_token;
}
async function healthy() {
  for(let i=0;i<120;i++) {
    const state = JSON.parse(run(['inspect',name]))[0];
    // Docker can reassign an ephemeral host port when restarting the container.
    base = `http://127.0.0.1:${state.NetworkSettings.Ports['3000/tcp'][0].HostPort}`;
    if(state.State.Health.Status === 'healthy') {
      try { if((await request('/health')).ok) return; } catch { /* Port forwarding may still be starting. */ }
    }
    await delay(500);
  }
  throw new Error('Container did not become healthy and reachable');
}

try {
  env.TUINAPP_PASSWORD_HASH = run(['run','--rm','-i',image,'hash-password','--stdin'],{input:password});
  for(const volume of [data,backups]) {run(['volume','create',volume]);volumes.push(volume);}
  if(source) {
    run(['create','--name',importer,'-v',`${data}:/app/data`,image,'import','--source','/tmp/legacy.sqlite','--database','/app/data/tuinapp.sqlite']);
    importerCreated = true;
    run(['cp',source,`${importer}:/tmp/legacy.sqlite`]);
    const imported = JSON.parse(run(['start','--attach',importer]));
    assert.deepEqual([imported.plants,imported.activities],[177,9]);
    assert.equal(imported.source_sha256,originalHash);
    run(['rm',importer]);importerCreated = false;
  } else {
    run(['run','--rm','--read-only','-v',`${data}:/app/data`,image,'init','--database','/app/data/tuinapp.sqlite']);
  }
  run(['run','--detach','--name',name,'--read-only','--tmpfs','/tmp:rw,size=128m,mode=1777','--cap-drop=ALL','--security-opt','no-new-privileges:true','--health-interval=1s','--health-start-period=1s','--publish','127.0.0.1::3000','--env','TUINAPP_PASSWORD_HASH','-v',`${data}:/app/data`,'-v',`${backups}:/app/backups`,image]);
  containerCreated = true;
  const inspect = JSON.parse(run(['inspect',name]))[0];
  assert.notEqual(inspect.Config.User,'root');assert.ok(inspect.Config.User);
  assert.equal(inspect.HostConfig.ReadonlyRootfs,true);
  base = `http://127.0.0.1:${inspect.NetworkSettings.Ports['3000/tcp'][0].HostPort}`;
  await healthy();
  assert.equal((await request('/api/plants')).status,401);
  assert.match(await (await request('/')).text(),/TuinApp/);
  assert.match(await (await request('/icons/shade.svg')).text(),/<svg/);
  await signIn();
  const baseline = await (await request('/api/plants')).json();
  if(source) assert.deepEqual([baseline.length,baseline.filter(p=>p.needs_reorder).length],[177,17]);
  const plant = {name:'Container persistence test',sun_requirements:3,sow_periods:3,plant_periods:12,notes:'Keep after restart',needs_reorder:true};
  assert.equal((await request('/api/plants','POST',plant)).status,200);
  assert.equal((await request('/api/months/1/pdf')).headers.get('content-type'),'application/pdf');
  for(const path of ['/api/imports/preview','/api/imports/tsv']) assert.equal((await request(path,'POST',{content:'removed'})).status,404);
  assert.equal((await request('/api/backups','POST')).status,200);
  const verified = await request('/api/backups/verify','POST');assert.equal(verified.status,200);
  assert.ok((await verified.json()).last_restore_verified_at);
  const archive = await request('/api/backups/download');assert.equal(archive.status,200);
  assert.equal(Buffer.from(await archive.arrayBuffer()).subarray(0,2).toString(),'PK');
  run(['restart',name]);await healthy();await signIn();
  const saved = await (await request('/api/plants')).json();
  assert.equal(saved.length,baseline.length+1);assert.equal(saved.find(p=>p.name===plant.name).notes,plant.notes);
  assert.deepEqual(saved.filter(p=>p.name!==plant.name),baseline);
  assert.ok((await (await request('/api/backups/status')).json()).latest);
  console.log('Container passed: non-root/read-only runtime, login, static assets, writes, PDF, backups, recovery and restart persistence.');
} catch(error) {
  if(containerCreated) console.error(run(['logs',name]));
  throw error;
} finally {
  if(containerCreated) run(['rm','--force',name]);
  if(importerCreated) run(['rm','--force',importer]);
  for(const volume of volumes) run(['volume','rm',volume]);
  assert.equal(hash(),originalHash,'Golden source must remain unchanged');
}
