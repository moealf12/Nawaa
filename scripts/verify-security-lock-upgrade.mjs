// Disposable CI: derive a minimal npm lockfile-only transitive patch.
// This script DOES NOT commit, push or modify production.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';

const before=JSON.parse(readFileSync('package-lock.json','utf8'));
const pkgBefore=readFileSync('package.json','utf8');
const patch=spawnSync('npm',['update','--package-lock-only','--ignore-scripts',
  '--no-fund','--no-audit','ip-address','undici'],{
  encoding:'utf8',timeout:120_000,maxBuffer:2*1024*1024
});
if(patch.status!==0)throw Error('npm_lock_only_update_failed: '+patch.stderr.slice(0,800));
const after=JSON.parse(readFileSync('package-lock.json','utf8'));
if(readFileSync('package.json','utf8')!==pkgBefore)
  throw Error('unexpected_package_manifest_change');
const changes={};
for(const name of new Set([...Object.keys(before.packages),...Object.keys(after.packages)])){
 if(JSON.stringify(before.packages[name])!==JSON.stringify(after.packages[name]))
   changes[name]=after.packages[name]??null;
}
const keys=Object.keys(changes);
if(keys.length<2||keys.length>8||!keys.includes('node_modules/ip-address')||
   !keys.includes('node_modules/undici'))
  throw Error('unexpected_transitive_lock_diff: '+JSON.stringify(keys));
if(after.packages['node_modules/ip-address']?.version!=='10.7.4'||
   after.packages['node_modules/undici']?.version!=='7.30.1')
  throw Error('unexpected_patched_versions');
console.log('V2183_LOCK_DELTA '+JSON.stringify({keys,changes,
  rootUnchanged:JSON.stringify(before.packages[''])===JSON.stringify(after.packages[''])}));
const ci=spawnSync('npm',['ci','--ignore-scripts','--no-fund','--no-audit'],{
  encoding:'utf8',timeout:150_000,maxBuffer:2*1024*1024
});
if(ci.status!==0)throw Error('patched_lock_npm_ci_failure: '+ci.stderr.slice(0,800));
const aud=spawnSync('npm',['audit','--omit=dev','--json'],{
  encoding:'utf8',timeout:150_000,maxBuffer:3*1024*1024
});
let scan;
try{scan=JSON.parse(aud.stdout)}catch{throw Error('audit_missing_json');}
if(scan.error||!scan.metadata?.vulnerabilities)throw Error('audit_missing_metadata');
console.log('V2183_PATCH_AUDIT '+JSON.stringify({counts:scan.metadata.vulnerabilities,
  advisoryKeys:Object.keys(scan.vulnerabilities||{})}));
if(Object.keys(scan.vulnerabilities||{}).length||aud.status!==0)
  throw Error('unresolved_transitive_advisories');
