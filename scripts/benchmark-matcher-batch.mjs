// Deterministic, zero-network, paired CPU benchmark. NOT a prediction of
// customer p95 or a claim about third-party merchant acquisition latency.
// Run: node scripts/benchmark-matcher-batch.mjs
import {performance} from "node:perf_hooks";
import {assessOfferMatch,createOfferMatchAssessor} from "../src/search-query.mjs";

const queries=[
  "iPhone","iPhone 17 256GB","آيفون 17","Samsung Galaxy S25",
  "PS5","PS5 Slim Disc","سماعات بلوتوث","HP laptop","bluetooth headphones",
];
const titles=[
  "Apple iPhone 17 256GB","Apple iPhone 17 Pro 256GB",
  "Apple iPhone 17 512GB","Samsung Galaxy S25 256GB",
  "Samsung Galaxy S25 Ultra","Sony PS5 Slim Console Disc Edition",
  "Sony PS5 Disc Drive Standalone","Sony PS5 Controller Charger",
  "JBL Bluetooth Headphones","JBL Bluetooth Speaker",
  "HP Pavilion 15 Laptop 16GB 512GB","HP SSD Laptop Storage Kit",
];
const offers=Array.from({length:96},(_,i)=>({
  title:titles[i%titles.length],
  brand:"",provider:i%2?"jarir-direct":"extra-unbxd",
  sourceUrl:"https://example.com/item/"+i,
  specs:{storage:i%3===0?"256GB":"512GB"},
}));
const hashResult=values=>JSON.stringify(values.map(o=>[o.exactMatch,o.matchConfidence]));
const measure=(fn,rounds=5)=>{
  const measurements=[];
  for(let r=0;r<rounds;r++){
    const started=performance.now(),cpu=process.cpuUsage();
    let checksum=0;
    for(const query of queries){
      const scorer=fn(query);
      for(let repeat=0;repeat<8;repeat++){
        for(const offer of offers){
          const match=scorer(offer);
          checksum += Math.round((match.matchConfidence||0)*100);
        }
      }
    }
    const elapsed=performance.now()-started;
    const usage=process.cpuUsage(cpu);
    measurements.push({elapsedMs:Math.round(elapsed),cpuMs:Math.round((usage.user+usage.system)/1000),checksum});
  }
  return measurements;
};
const legacy=q=>offer=>assessOfferMatch(q,offer);
const compiled=q=>createOfferMatchAssessor(q);
for(const q of queries){
  const expected=hashResult(offers.map(legacy(q)));
  const actual=hashResult(offers.map(compiled(q)));
  if(expected!==actual)throw new Error("BENCHMARK_SEMANTIC_MISMATCH");
}
// Warm up both paths before collecting measurements.
measure(legacy,1);measure(compiled,1);
const legacyRuns=measure(legacy),compiledRuns=measure(compiled);
const checksum=new Set([...legacyRuns,...compiledRuns].map(x=>x.checksum));
if(checksum.size!==1)throw new Error("BENCHMARK_CHECKSUM_MISMATCH");
const median=(values)=>{const v=[...values].sort((a,b)=>a-b);return v[Math.floor(v.length/2)]};
const summary={
  kind:"NAWAA_MATCHER_CPU_BENCHMARK",
  environment:"isolated_synthetic_no_network",
  queries:queries.length,offersPerQuery:offers.length,repeatPerQuery:8,rounds:5,
  legacyMedianCpuMs:median(legacyRuns.map(x=>x.cpuMs)),
  compiledMedianCpuMs:median(compiledRuns.map(x=>x.cpuMs)),
  legacyMedianElapsedMs:median(legacyRuns.map(x=>x.elapsedMs)),
  compiledMedianElapsedMs:median(compiledRuns.map(x=>x.elapsedMs)),
  semanticParity:true,
  limitation:"Synthetic process CPU; not a live source, per-request benchmark or proof of lower tail latency.",
};
console.log(JSON.stringify(summary));
