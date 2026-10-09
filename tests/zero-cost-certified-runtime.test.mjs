import test from "node:test";
import assert from "node:assert/strict";
import {CERTIFIED_SOURCE_HOSTS} from "../src/certified-source-hosts.mjs";
import {CERTIFIED_PILOT_SOURCES} from "../src/certified-pilot.mjs";
import {issueSourceAttestation} from "../server/tooling/source-attestation.mjs";
import {startCertifiedIngestionWorker} from "../server/tooling/certified-ingestion-runtime.mjs";
import {OFFER_INGESTION_QUEUE} from "../server/tooling/offer-ingestion-worker.mjs";
const key="safe-isolated-test-key-at-least-32-bytes-long";
const env={DATABASE_URL:"postgres://localhost/test",NAWAA_ENABLE_BACKGROUND_JOBS:"1",
 NAWAA_ENABLE_CERTIFIED_INGESTION:"1",NAWAA_INGESTION_SIGNING_KEY:key};
test("trusted host catalog has exactly the 15 previously approved pilot sources",()=>{
 assert.deepEqual(Object.keys(CERTIFIED_SOURCE_HOSTS).sort(),CERTIFIED_PILOT_SOURCES.map(s=>s.id).sort());
 assert.ok(Object.values(CERTIFIED_SOURCE_HOSTS).every(v=>v.length>0&&v.every(host=>host.includes("."))));
});
test("worker startup is opt-in, requiring long local signing secret",async()=>{
 await assert.rejects(startCertifiedIngestionWorker({env:{...env,NAWAA_ENABLE_CERTIFIED_INGESTION:"0"}}),/disabled/);
 await assert.rejects(startCertifiedIngestionWorker({env:{...env,NAWAA_INGESTION_SIGNING_KEY:"short"}}),/signing_key_required/);
});
test("certified worker rejects forged job and accepts matching signature",async()=>{
 let handler,queueName,started=0,stopped=0,writes=0;
 const factory=()=>({
  start:async()=>{started++;},
  createQueue:async name=>{queueName=name;},
  work:async (name,opts,fn)=>{handler=fn;},
  stop:async()=>{stopped++;},
 });
 const running=await startCertifiedIngestionWorker({env,bossFactory:factory,
  record:async()=>{writes++;return {recorded:true,observationId:7}}});
 assert.equal(started,1);assert.equal(queueName,OFFER_INGESTION_QUEUE);
 const offer={title:"IKEA chair fixture",sourceUrl:"https://www.ikea.com/sa/en/p/chair-12345678",
  productPrice:250,currency:"SAR",merchant:"IKEA"};
 const attestation=issueSourceAttestation({sourceId:"ikea-sa",offer,
  sourceHosts:CERTIFIED_SOURCE_HOSTS,key});
 const payload={sourceId:"ikea-sa",verifiedBySource:"ikea-sa",offer,attestation};
 await assert.rejects(handler([{data:{...payload,attestation:"forged"}}]),/trusted_source_verifier_required/);
 await handler([{data:payload}]);
 assert.equal(writes,1);
 await running.stop();assert.equal(stopped,1);
});
