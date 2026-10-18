// v16.1 real PostgreSQL16 + Meilisearch1.10.3 proof. Synthetic price and
// stock transitions only. Separate Node writer processes; Docker restart.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readFile,writeFile} from "node:fs/promises";
import {MeiliSearch} from "meilisearch";
import {canonicalOfferPayload} from "../server/canonical-offer-identity.mjs";
import {initializeCanonicalIndex,commitCanonicalObservation,currentCanonical,
  publishCanonicalOutbox,guardedCanonicalSearch,reconcileCanonicalIndex}
  from "../server/omega-canonical-index.mjs";
import {searchIndexedOffers} from "../server/search-index.mjs";

const stage=process.argv[2],stateFile=".omega-canonical-stage.json";
assert.equal(process.env.NODE_ENV,"test");
assert.equal(process.env.NAWAA_CANONICAL_INDEX_TEST,"1");
assert.equal(process.env.MEILI_HOST,"http://127.0.0.1:7700");
assert.equal(process.env.MEILI_INDEX,"nawaa_ci_omega");
assert.ok(process.env.NAWAA_TEST_DATABASE_URL);
const sdk=new MeiliSearch({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
const index=sdk.index(process.env.MEILI_INDEX);
const url=n=>"https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-"+n+".html";
const base={
  sourceUrl:url("677770"),
  title:"Sony PlayStation 5 Slim Console Blu-ray Edition 1 TB Bundle with DualSense Wireless Controller",
  merchant:"Jarir",merchantCountryCode:"SA",currency:"SAR",condition:"new",
  sourceMeta:{productId:"677770"},specs:{brand:"Sony",modelNumber:"CFI2116ACFIZC"},
  availability:"unknown"
};
const futureFixture=(time,price,availability)=>({...base,observedAt:time,
  productPrice:price,availability});
const invoke=(args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),...args],
    {env:process.env,stdio:["ignore","pipe","pipe"]});
  let out="",err="";
  child.stdout.on("data",v=>out+=v);
  child.stderr.on("data",v=>err+=v);
  child.on("error",reject);
  child.on("close",code=>code===0?resolve({pid:child.pid,output:out.trim()}):
    reject(Error("independent process exit "+code+" "+err+" "+out)));
});

if(stage==="worker"){
  const incoming=futureFixture(process.argv[3],Number(process.argv[4]),process.argv[5]);
  const outcome=await commitCanonicalObservation(incoming);
  console.log("OMEGA_WORKER "+JSON.stringify({pid:process.pid,outcome}));
  process.exit(0);
}else if(stage==="write"){
  await initializeCanonicalIndex();
  const now=Date.now();
  const t1=new Date(now-5500).toISOString();
  const t2=new Date(now-3500).toISOString();
  const t3=new Date(now-700).toISOString();
  const packages=[
    {...base,sourceUrl:url("627671"),sourceMeta:{productId:"627671"},
      specs:{modelNumber:"CFI2016B01Y"}},
    {...base,sourceUrl:url("627678"),sourceMeta:{productId:"627678"},
      specs:{modelNumber:"CFI2016A01Y"}},
    {...base,sourceUrl:url("670688"),sourceMeta:{productId:"670688"},
      specs:{modelNumber:"CFI2116AFNTVC"}},base
  ];
  assert.equal(new Set(packages.map(p=>canonicalOfferPayload({...p,observedAt:t2,productPrice:3000}).documentId)).size,4);
  const normalized=canonicalOfferPayload({...base,observedAt:t2,productPrice:3199});
  const tracking=canonicalOfferPayload({...base,sourceUrl:url("677770")+"?utm_source=test",
    observedAt:t2,productPrice:3199});
  assert.equal(normalized.offerKey,tracking.offerKey);
  assert.equal(canonicalOfferPayload({...base,productPrice:3000}),null);
  const writers=await Promise.all([
    invoke(["worker",t2,"3199","out_of_stock"]),
    invoke(["worker",t1,"3049","unknown"])
  ]);
  const stored=await currentCanonical(normalized.offerKey);
  assert.equal(stored.offer.productPrice,3199);
  assert.equal(stored.offer.availability,"out_of_stock");
  assert.equal(stored.observedAt,t2);
  const conflict=await commitCanonicalObservation(futureFixture(t2,3201,"unknown"));
  assert.equal(conflict.state,"equal_time_conflict");
  const duplicate=await commitCanonicalObservation(futureFixture(t2,3199,"out_of_stock"));
  assert.equal(duplicate.state,"duplicate");
  const prior=await commitCanonicalObservation(futureFixture(t1,3049,"unknown"));
  assert.equal(prior.state,"rejected_older");
  const publication=await publishCanonicalOutbox();
  assert.ok(publication.some(p=>p.status==="published"));
  // Recreate the exact remote-task hazard AFTER the genuine newest task.
  const stale=await index.addDocuments([{
    ...futureFixture(t1,3049,"unknown"),
    id:normalized.documentId,offerKey:normalized.offerKey,
    canonicalRevision:0,canonicalFingerprint:"old-test-only"
  }]);
  const staleTask=await index.waitForTask(stale.taskUid);
  assert.equal(staleTask.status,"succeeded");
  const raw=await index.getDocument(normalized.documentId);
  assert.equal(raw.productPrice,3049,"physical index deliberately corrupted");
  const safe=await guardedCanonicalSearch("PlayStation");
  assert.equal(safe.offers.length,1);
  assert.equal(safe.offers[0].productPrice,3199);
  assert.equal(safe.offers[0].availability,"out_of_stock");
  assert.equal(safe.offers[0].indexLagged,true);
  // Direct real application search-index read routing must use same guard.
  const routed=await searchIndexedOffers("PlayStation");
  assert.equal(routed.offers[0].productPrice,3199);
  const repair=await reconcileCanonicalIndex();
  assert.equal(repair.repaired.length,1);
  assert.equal((await index.getDocument(normalized.documentId)).productPrice,3199);
  // Simulated worker termination before index publication: T3 committed
  // to database/outbox by another process, with NO Meili publication.
  const crashingWorker=await invoke(["worker",t3,"3299","out_of_stock"]);
  const after=await currentCanonical(normalized.offerKey);
  assert.equal(after.offer.productPrice,3299);
  await writeFile(stateFile,JSON.stringify({key:normalized.offerKey,id:normalized.documentId,t1,t2,t3}),"utf8");
  console.log("REAL_OMEGA_STAGE "+JSON.stringify({stage,writerPids:writers.map(x=>x.pid),
    newestCanonical:stored.offer.productPrice,concurrentSafe:true,
    equalTimeConflict:conflict.state,duplicate:duplicate.state,
    olderRejected:prior.state,realTaskUid:stale.taskUid,
    physicalStaleTaskReproduced:true,customerReadSafe:true,
    firstReconcileRepairs:repair.repaired.length,
    durablePendingRevision:after.revision,crashedWorkerPid:crashingWorker.pid,
    syntheticPrices:true}));
  process.exit(0);
}else if(stage==="read"){
  const saved=JSON.parse(await readFile(stateFile,"utf8"));
  const committed=await currentCanonical(saved.key);
  assert.equal(committed.offer.productPrice,3299);
  assert.equal(committed.observedAt,saved.t3);
  const before=await guardedCanonicalSearch("PlayStation");
  assert.equal(before.offers.length,1);
  assert.equal(before.offers[0].productPrice,3299);
  assert.equal(before.offers[0].indexLagged,true);
  const pending=await publishCanonicalOutbox();
  assert.ok(pending.some(o=>o.revision===committed.revision&&o.status==="published"));
  const after=await guardedCanonicalSearch("PlayStation");
  assert.equal(after.offers[0].productPrice,3299);
  assert.equal(after.offers[0].indexLagged,false);
  assert.equal((await index.getDocument(saved.id)).productPrice,3299);
  const repeat=await reconcileCanonicalIndex();
  assert.equal(repeat.repaired.length,0);
  const replay=await commitCanonicalObservation(futureFixture(saved.t1,3049,"unknown"));
  assert.equal(replay.state,"rejected_older");
  const expired=await guardedCanonicalSearch("PlayStation",{now:Date.parse(saved.t3)+46000});
  assert.equal(expired.offers.length,0);
  console.log("REAL_OMEGA_STAGE "+JSON.stringify({stage,pid:process.pid,
    meiliRestarted:true,canonicalAfterRestart:3299,customerReadSafe:true,
    durableOutboxRecovered:true,taskUid:pending.find(x=>x.status==="published")?.taskUid,
    staleReplayRejected:true,reconcileIdempotent:true,expiredRejected:true,
    physicalIndexNewer:true,syntheticPrices:true}));
  process.exit(0);
}else throw Error("usage: write|read|worker");
