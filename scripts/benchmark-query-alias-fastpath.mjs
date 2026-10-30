// Paired synthetic CPU benchmark; no merchant requests and no production writes.
import {normalizeSearchQuery} from "../src/search-query.mjs";
import {ungatedBaseline,QUERIES} from "./legacy-query-alias-baseline.mjs";
const historical=await ungatedBaseline();
const english=QUERIES.filter(s=>!/[\u0600-\u06ff]/u.test(s));
const arabic=QUERIES.filter(s=>/[\u0600-\u06ff]/u.test(s));
const corpus=[
  ...english,
  ...Array.from({length:500},(_,i)=>"iPhone 17 Pro "+(i%2?"256GB":"512GB")+" Black Case "+i),
  ...Array.from({length:300},(_,i)=>"Samsung Galaxy S25 Ultra "+i+" Specs"),
];
const measure=(fn,rounds=5)=>{
  const observations=[];
  for(let i=0;i<rounds;i++){
    let checksum=0;
    const cpu=process.cpuUsage();
    const start=performance.now();
    for(const entry of corpus){
      const result=fn(entry);
      checksum+=result.length;

    }
    const use=process.cpuUsage(cpu);
    observations.push({cpuMs:(use.user+use.system)/1000,wallMs:performance.now()-start,checksum});
  }
  return observations;
};
for(const entry of corpus){
  if(historical.normalizeSearchQuery(entry)!==normalizeSearchQuery(entry))
    throw Error("SEMANTIC_DRIFT");
}
// Both function versions warm up; order is reversed between benchmark pairs.
measure(historical.normalizeSearchQuery,1);measure(normalizeSearchQuery,1);
const previous=[],current=[];
for(let i=0;i<5;i++){
  const first=i%2 ? normalizeSearchQuery : historical.normalizeSearchQuery;
  const second=i%2 ? historical.normalizeSearchQuery : normalizeSearchQuery;
  const a=measure(first,1)[0],b=measure(second,1)[0];
  if(first===normalizeSearchQuery){current.push(a);previous.push(b);}
  else {previous.push(a);current.push(b);}
}
const checksums=new Set([...previous,...current].map(x=>x.checksum));
if(checksums.size!==1)throw Error("NORMALIZATION_CHECKSUM_MISMATCH");
const median=(values)=>{const a=values.slice().sort((a,b)=>a-b);return Math.round(a[Math.floor(a.length/2)]*100)/100;};
const r={kind:"NAWAA_ARABIC_ALIAS_FASTPATH_CPU_BENCHMARK",
  corpus:corpus.length,englishCases:english.length,arabicCases:arabic.length,
  rounds:5,legacyMedianCpuMs:median(previous.map(x=>x.cpuMs)),
  optimizedMedianCpuMs:median(current.map(x=>x.cpuMs)),
  legacyMedianWallMs:median(previous.map(x=>x.wallMs)),
  optimizedMedianWallMs:median(current.map(x=>x.wallMs)),
  semanticChecksumEqual:true,
  limitation:"Synthetic single-runner data: not live merchant search p95 or price/identity proof."};
console.log(JSON.stringify(r));
