// Actual PostgreSQL/Meili; source-derived identity, explicitly SIMULATED chronology.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {canonicalReadBoundary,commitCanonicalObservation,currentCanonical,publishCanonicalOutbox,guardedCanonicalSearch} from '../server/omega-canonical-index.mjs';
const saved=JSON.parse(await readFile('.omega-canonical-stage.json','utf8'));
const previous=await currentCanonical(saved.key);
const now=Date.now();
const live={...previous.offer,dataKind:'live',productPrice:3399,observedAt:new Date(Math.max(now,Date.parse(previous.observedAt)+1)).toISOString()};
const accepted=await canonicalReadBoundary([previous.offer,live],{acceptLive:true});
assert.equal(accepted.length,1);assert.equal(accepted[0].productPrice,3399);
const late={...live,productPrice:2999,observedAt:new Date(Date.parse(live.observedAt)-1).toISOString()};
assert.equal((await canonicalReadBoundary([late],{acceptLive:true}))[0].productPrice,3399);
const cached={...live,dataKind:'indexed'};
const newer={...live,productPrice:3499,observedAt:new Date(Date.parse(live.observedAt)+1).toISOString()};
await commitCanonicalObservation(newer);
assert.equal((await canonicalReadBoundary([cached]))[0].productPrice,3499);
assert.equal((await canonicalReadBoundary([{...newer,dataKind:'indexed',productPrice:9999,observedAt:new Date(Date.parse(newer.observedAt)+1).toISOString()}]))[0].productPrice,3499);
assert.equal((await canonicalReadBoundary([cached],{now:Date.parse(newer.observedAt)+45000})).length,1);
assert.equal((await canonicalReadBoundary([cached],{now:Date.parse(newer.observedAt)+45001})).length,0);
await publishCanonicalOutbox();
assert.ok((await guardedCanonicalSearch('PS5')).offers.some(o=>o.productPrice===3499));
const timings=[];
for(let i=0;i<20;i++){const t=performance.now();await canonicalReadBoundary([cached]);timings.push(performance.now()-t);}
timings.sort((a,b)=>a-b);
console.log('REAL_OMEGA_MIXED '+JSON.stringify({syntheticTransitions:true,independentMerchantAcquisitions:false,newLiveAccepted:true,lateLiveRejected:true,cachedRehydrated:true,indexCannotMintEvidence:true,freshnessBoundary:[45000,45001],readSamples:20,readMedianMs:timings[10],p95Certified:false}));
process.exit(0);
