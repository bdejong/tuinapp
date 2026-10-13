// The pinned renderer's Wasm date shim lacks two methods used by PDF metadata.
// Patch only that shim in an isolated, ignored copy. Production Rust stays untouched.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('.',import.meta.url));
const run=(command,args)=>{const r=spawnSync(command,args,{cwd:root,stdio:'inherit'});if(r.error||r.status!==0)throw new Error(`${command} failed`);};
const vendor=resolve(root,'vendor');mkdirSync(vendor,{recursive:true});
const archive=join(vendor,'printpdf-0.7.0.crate');
if(!existsSync(archive)) {
  const response=await fetch('https://static.crates.io/crates/printpdf/printpdf-0.7.0.crate');
  if(!response.ok)throw new Error('Could not download pinned printpdf');
  writeFileSync(archive,Buffer.from(await response.arrayBuffer()));
}
if(createHash('sha256').update(readFileSync(archive)).digest('hex')!=='c30a4cc87c3ca9a98f4970db158a7153f8d1ec8076e005751173c57836380b1d')throw new Error('printpdf checksum mismatch');
run('tar',['-xzf',archive,'-C',vendor]);
const date=join(vendor,'printpdf-0.7.0/src/date.rs');
let source=readFileSync(date,'utf8');
const before='pub fn month(&self) -> u32 {\n            self.0.get_month() + 1u32\n        }';
if(!source.includes(before))throw new Error('Unexpected printpdf date implementation');
source=source.replace(before,`pub fn month(&self) -> time::Month {
            time::Month::try_from((self.0.get_utc_month() + 1) as u8).unwrap()
        }
        pub fn offset(&self) -> time::UtcOffset { time::UtcOffset::UTC }`);
for(const method of ['full_year','date','hours','minutes','seconds'])source=source.replaceAll(`.get_${method}()`,`.get_utc_${method}()`);
writeFileSync(date,source);
run(process.execPath,['../../scripts/cargo.mjs','build','--manifest-path','Cargo.toml','--target','wasm32-unknown-unknown','--release','--locked']);
const cached=join(homedir(),'.cache/tuinapp-toolchain/cargo/bin/wasm-bindgen');
run(process.env.WASM_BINDGEN || (existsSync(cached)?cached:'wasm-bindgen'),['target/wasm32-unknown-unknown/release/tuinapp_pdf_wasm.wasm','--out-dir','pkg','--target','web']);
