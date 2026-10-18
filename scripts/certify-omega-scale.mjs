// Real-service fairness counterexample and bounded-repeatability proof.
// 121 synthetic products based on the recorded source identity, NOT live listings.
import assert from 'node:assert/strict';
import pg from 'pg';
import {MeiliSearch} from 'meilisearch';
import {performance} from 'node:perf_hooks';
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.NAWAA_CANONICAL_INDEX_TEST,'1');
assert.equal(process.env.MEILI_HOST,'http://127.0.0.1:7700');assert.equal(process.env.MEILI_INDEX,'nawaa_ci_omega');
const pool=new pg.Pool({connectionString:process.env.NAWAA_TEST_DATABASE_URL});
const sdk=new MeiliSearch({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
const index=sdk.index(process.env.MEILI_INDEX);
const baseline=process.argv.includes('--baseline');
const m=await import(baseline?'../server/.omega-before.mjs':'../server/omega-canonical-index.mjs');
await m.initializeCanonicalIndex();
await pool.query('TRUNCATE nawaa_ci_omega_canonical,nawaa_ci_omega_outbox');
if(!baseline)await pool.query('TRUNCATE nawaa_ci_omega_reconcile');
await index.waitForTask((await index.deleteAllDocuments()).taskUid);
const epoch=Date.now()+10000;
const fixture=i=>({sourceUrl:`https://www.jarir.com/sa-en/omega-test-${String(i).padStart(4,'0')}.html`,title:'Sony PlayStation 5 Slim Console',merchant:'Jarir',merchantCountryCode:'SA',currency:'SAR',condition:'new',productPrice:3000+i,sourceMeta:{productId:'omega-test-'+i},observedAt:new Date(epoch).toISOString(),dataKind:'live'});
const batches=[];
for(const count of [1,10,50,120]){
 const values=Array.from({length:count},(_,i)=>fixture(i));
 const t=performance.now();for(const o of values)await m.commitCanonicalObservation(o);
 const writeMs=performance.now()-t;
 const reads=[];
 if(!baseline)for(let n=0;n<20;n++){const start=performance.now();const result=await m.canonicalReadBoundary(values);assert.equal(result.length,count);reads.push(performance.now()-start);}
 reads.sort((a,b)=>a-b);batches.push({count,writeMs,readSamples:reads.length,readMedianMs:reads[10]??null,p95Certified:false});
}
await m.commitCanonicalObservation(fixture(120));
const pages=[];
for(let n=0;n<3;n++)pages.push(await m.reconcileCanonicalIndex({limit:50}));
const stats=await index.getStats();
if(baseline){assert.equal(stats.numberOfDocuments,50,'baseline counterexample must reproduce prefix starvation');console.log('REAL_OMEGA_FAIRNESS_RED '+JSON.stringify({expected:121,actual:50,passes:3}));}
else{
 assert.equal(stats.numberOfDocuments,121,'later keys starved');
 assert.deepEqual(pages.map(p=>p.inspected),[50,50,21]);
 const repeat=[];for(let n=0;n<3;n++)repeat.push(await m.reconcileCanonicalIndex({limit:50}));
 assert.equal(repeat.flatMap(p=>p.repaired).length,0);
 const recall=await m.guardedCanonicalSearch('PS5',{limit:200});assert.equal(recall.offers.length,121);
 const expired=await m.guardedCanonicalSearch('PS5',{limit:200,now:epoch+45001});assert.equal(expired.offers.length,0);
 console.log('REAL_OMEGA_SCALE '+JSON.stringify({pages:pages.map(p=>p.inspected),documents:stats.numberOfDocuments,recall:recall.offers.length,falseExclusions:0,repeatRepairs:0,batches,syntheticTransitions:true,p95Certified:false}));
}
await pool.end();process.exit(0);
