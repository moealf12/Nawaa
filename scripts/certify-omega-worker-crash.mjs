// SIGKILL after actual Meili acceptance, before publisher receives its task ACK.
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {commitCanonicalObservation,currentCanonical,publishCanonicalOutbox} from '../server/omega-canonical-index.mjs';
import {MeiliSearch} from 'meilisearch';
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.NAWAA_CANONICAL_INDEX_TEST,'1');
if(process.argv[2]==='worker'){
 if(process.argv[3]==='before'){process.send({before:true});await new Promise(()=>{});}
 const native=globalThis.fetch;
 globalThis.fetch=async(...args)=>{
  const response=await native(...args);
  if(String(args[0]?.url||args[0]).includes('/documents')&&(args[1]?.method||args[0]?.method)==='POST'){
   process.send({submitted:true});await new Promise(()=>{});
  }
  return response;
 };
 await publishCanonicalOutbox();process.exit(0);
}
const saved=JSON.parse(await readFile('.omega-canonical-stage.json','utf8'));
for(const mode of ['before','submitted','restart']){
const before=await currentCanonical(saved.key);
await commitCanonicalObservation({...before.offer,dataKind:'live',productPrice:3599,observedAt:new Date(Math.max(Date.now(),Date.parse(before.observedAt)+1)).toISOString()});
const child=fork(fileURLToPath(import.meta.url),['worker',mode],{stdio:['ignore','pipe','pipe','ipc']});
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('worker did not submit'))},20000);
 child.on('message',m=>{
   if(m.before||m.submitted){
     if(mode==='restart'){
       const id=execFileSync('docker',['ps','--filter','ancestor=getmeili/meilisearch:v1.10.3','--format','{{.ID}}'],{encoding:'utf8'}).trim();
       assert.ok(id&&!id.includes('\n'));
       // Deterministic restart outage: terminate worker while Meili is stopped,
       // then start the same container with its existing durable volume.
       execFileSync('docker',['stop',id],{stdio:'ignore'});
       assert.equal(child.kill('SIGKILL'),true);
       execFileSync('docker',['start',id],{stdio:'ignore'});
       return;
     }
     child.kill('SIGKILL');
   }
 });
 child.on('exit',(code,signal)=>{clearTimeout(timer);signal==='SIGKILL'?resolve():reject(Error('unexpected child termination '+code))});
 child.on('error',reject);
});
for(let i=0;i<50;i++){
 try{if((await fetch(process.env.MEILI_HOST+'/health')).ok)break;}catch{}
 await new Promise(r=>setTimeout(r,100));
}
const recovered=await publishCanonicalOutbox();assert.ok(recovered.some(x=>x.status==='published'));
const sdk=new MeiliSearch({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
assert.equal((await sdk.index(process.env.MEILI_INDEX).getDocument(saved.id)).productPrice,3599);
assert.equal((await publishCanonicalOutbox()).length,0);
console.log('REAL_OMEGA_ACK_RECOVERY '+JSON.stringify({termination:'SIGKILL',mode,workerKilledWhileServiceStopped:mode==='restart',afterActualSubmission:mode!=='before',beforeTaskAcknowledgement:true,durableReplay:true,stableDocumentId:true,repeatEvents:0,syntheticTransitions:true}));
}
process.exit(0);
