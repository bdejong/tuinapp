// No Cloudflare account, remote calls, or deployment: run the production Workers
// engine locally, feed JSON fixtures, and save PDFs for native/wasm comparison.
import { Miniflare } from 'miniflare';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('.',import.meta.url));
const fixtures = resolve(process.argv[2] || '../../.local/cloudflare-pdf');
const mf = new Miniflare({
  modules: true,
  scriptPath: resolve(root,'worker.mjs'),
  modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true},{type:'CompiledWasm',include:['**/*.wasm'],fallthrough:true}],
  compatibilityDate:'2026-07-30',
});
const measurements=[];
try {
  const files=(await readdir(fixtures)).filter(f=>/^(empty|overflow|month-\d{2})\.json$/.test(f)).sort();
  assert.ok(files.length>=2);
  for (const file of files) {
    const input=await readFile(resolve(fixtures,file),'utf8');
    const start=performance.now();
    const response=await mf.dispatchFetch('http://pdf.local/',{method:'POST',body:input});
    assert.equal(response.status,200,await (response.status===200 ? Promise.resolve('') : response.text()));
    assert.equal(response.headers.get('content-type'),'application/pdf');
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    await writeFile(resolve(fixtures,file.replace('.json','-worker.pdf')),bytes);
    measurements.push({fixture:file,bytes:bytes.length,local_wall_ms:Math.round((performance.now()-start)*100)/100});
  }
  assert.equal((await mf.dispatchFetch('http://pdf.local/')).status,405);
  assert.equal((await mf.dispatchFetch('http://pdf.local/',{method:'POST',body:'not json'})).status,400);
  assert.equal((await mf.dispatchFetch('http://pdf.local/',{method:'POST',body:'x'.repeat(2_000_001)})).status,413);
  // Repeated requests in one isolate exercise allocator reuse and cleanup.
  const input=await readFile(resolve(fixtures,files[0]),'utf8');
  for(let i=0;i<100;i++) {
    const response=await mf.dispatchFetch('http://pdf.local/',{method:'POST',body:input});
    assert.equal(response.status,200);await response.arrayBuffer();
  }
  const wasm=await readFile(resolve(root,'pkg/tuinapp_pdf_wasm_bg.wasm'));
  const report={runtime:'Cloudflare workerd via Miniflare 4.20260730.0 (local)',wasm_bytes:wasm.length,wasm_gzip_bytes:gzipSync(wasm).length,measurements,repeated_requests:100};
  await writeFile(resolve(fixtures,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await mf.dispose(); }
