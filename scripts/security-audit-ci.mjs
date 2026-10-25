// Security inventory only: never executes npm audit fix or modifies lockfiles.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const pkg=JSON.parse(readFileSync('package.json','utf8'));
const result=spawnSync('npm',['audit','--omit=dev','--json'],{
  encoding:'utf8',timeout:120_000,maxBuffer:8*1024*1024
});
if(result.error)throw result.error;
let audit;
try{audit=JSON.parse(result.stdout)}catch{
  throw Error('npm_audit_non_json_response: '+(result.stderr||'').slice(0,300));
}
if(audit.error)throw Error('npm_audit_registry_error: '+JSON.stringify(audit.error).slice(0,380));
const v=audit.vulnerabilities;
if(!v||typeof v!=='object')throw Error('npm_audit_missing_vulnerabilities');
const problems=[];
for(const [name,item] of Object.entries(v).sort(([a],[b])=>a.localeCompare(b))){
  const direct=Object.hasOwn(pkg.dependencies||{},name);
  const transitivelyVia=(item.via||[]).map(via=>
    typeof via==='string'?{through:via}:{
      advisoryId:via.source,
      url:via.url,
      title:via.title,
      severity:via.severity,
      vulnerableRange:via.range
    });
  const explain=spawnSync('npm',['explain','--json',name],{
    encoding:'utf8',timeout:15000,maxBuffer:1024*1024
  });
  let paths=[];
  try{
    const p=JSON.parse(explain.stdout||'[]');
    paths=p.slice(0,4).map(x=>({
      installedVersion:x.version,location:x.location,
      dependedBy:(x.dependents||[]).slice(0,4).map(y=>({
        name:y.name,version:y.version,location:y.location,type:y.type
      }))
    }));
  }catch{}
  problems.push({name,severity:item.severity,direct,
    isDirect:item.isDirect,range:item.range,fixAvailable:item.fixAvailable,
    via:transitivelyVia.slice(0,6),paths});
}
console.log('V2183_AUDIT '+JSON.stringify({
  status:'DIAGNOSTIC_ONLY',scope:'npm audit --omit=dev --json',
  node:process.version,counts:audit.metadata?.vulnerabilities,
  directDependencies:Object.keys(pkg.dependencies||{}),
  advisories:problems
}));
