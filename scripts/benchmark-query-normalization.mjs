// Candidate-only CPU microbenchmark. Not an end-to-end SLA or a P95 proof.
// Compare against an exact previously certified checkout on the same Node runner.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const [baselineRoot='.',candidateRoot='.']=process.argv.slice(2);
const load=async root=>(await import(pathToFileURL(resolve(root,'src/search-query.mjs')).href)).normalizeSearchQuery;
const versions=[{name:'baseline',fn:await load(baselineRoot)},{name:'candidate',fn:await load(candidateRoot)}];
const terms=[
 'iPhone 17 Pro Max 256GB Black titanium', 'Apple iPhone 17 Pro 256 GB, Blue',
 'Sony PlayStation 5 Slim Disc Console 1TB', 'PS5 Disc Drive Digital Edition Slim',
 'HP Pavilion Laptop 16 GB RAM Intel Core Ultra 7',
 'Samsung Galaxy S25 Ultra 512 GB Silver',
 'ايفون ١٧ برو ماكس ٢٥٦ جيجا اسود',
 'ابغى ارخص لابتوب اتش بي ١٦ جيجا',
 'بلايستيشن ٥ سليم مع قارئ اقراص',
 'سماعات ايربودز برو ٢ ابل', 'Sony PS5 DualSense wireless controller',
 'Nike Air Max Running Shoes Black Size 42',
 'سواروفسكي خاتم فضي و ساعه ذهبية',
 'Dell Inspiron 15 i7 1TB Laptop',
 'Logitech MX Master 3S Mouse',
 'MacBook Air M4 16GB 512GB Midnight',
 'Samsung TV OLED 65-inch 4K',
 'جهاز ps5 برو مع يد تحكم وسماعه'
];
const inputs=[...terms];
for(let i=0;i<200;i++)inputs.push(terms[i%terms.length]+ ' '+terms[(i*7+3)%terms.length]);
for(const input of inputs){
  const a=versions[0].fn(input),b=versions[1].fn(input);
  assert.equal(b,a,'query normalization changed: '+JSON.stringify(input));
}
// A repeated global RegExp must not retain lastIndex across calls.
for(let i=0;i<200;i++)assert.equal(versions[1].fn(terms[6]),versions[0].fn(terms[6]));
const loops=300;
for(const v of versions)for(let i=0;i<20;i++)for(const input of inputs)v.fn(input);
const timings={baseline:[],candidate:[]};
let sink=0;
for(let round=0;round<6;round++){
  const order=round%2?[...versions].reverse():versions;
  for(const v of order){
    const start=performance.now();
    for(let i=0;i<loops;i++)for(const input of inputs)sink+=v.fn(input).length;
    timings[v.name].push(performance.now()-start);
  }
}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const baselineMedian=median(timings.baseline),candidateMedian=median(timings.candidate);
const record={inputCount:inputs.length,conversionsPerRound:inputs.length*loops,rounds:6,
  baselineMedianMs:Math.round(baselineMedian),candidateMedianMs:Math.round(candidateMedian),
  relativeCpuSpeedup:Number((baselineMedian/candidateMedian).toFixed(3)),
  semanticallyEquivalent:true,sink};
console.log('NORMALIZATION_BENCHMARK '+JSON.stringify(record));
