// Deterministic candidate-vs-parent semantic parity and bounded CPU A/B.
// Never use these synthetic timings as evidence of production P95.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const [baselineDir, candidateDir] = process.argv.slice(2);
if (!baselineDir || !candidateDir) throw Error('Expected baseline and candidate checkout paths');
const load = root => import(pathToFileURL(resolve(root,'src/search-query.mjs')).href);
const [baseline,candidate] = await Promise.all([load(baselineDir),load(candidateDir)]);
const titles = [
  'Sony PlayStation 5 PS5 Console Disc Edition 1TB',
  'PS5 Disc Drive accessory for Digital Edition',
  'PS5 DualSense Wireless Controller White',
  'Sony PS5 Slim Console Digital Edition',
  'PS5 Spider-Man Game Disc',
  'Apple iPhone 17 256GB Black New',
  'Apple iPhone 17 Pro Max 512GB Black',
  'Case for iPhone 17 256 GB Protective Cover',
  'iPhone 17 Screen Protector',
  'HP Laptop 15.6 inch 16GB RAM',
  'HP Laptop Replacement LCD Screen',
  'Logitech Wireless Mouse for HP Laptop',
  'Nike Running Shoes Black',
  'Nike Apple Watch Band Case',
  'شاحن ايفون 17 256 جيجابايت',
  'بلايستيشن 5 جهاز سليم',
  'غطاء هاتف ايفون 17 اسود',
  'Apple iPhone 17 refurbished 256GB',
  'Bluetooth earbuds wireless charging case',
  'Samsung Galaxy S25 Ultra 256GB',
];
const offers = Array.from({length:100},(_,i)=>({
  title:titles[i%titles.length],merchant:['eXtra','Jarir','Sharaf DG'][i%3],
  sourceUrl:'https://example.com/item/'+i,productPrice:500+i*13,
  currency:'SAR',observedAt:'2026-10-16T00:00:00Z',
  specs:{brand:i%2?'Apple':'Sony',storage:i%3?'256 GB':'1TB',color:i%2?'Black':'White'},
  condition:i%20===17?'refurbished':'new'
}));
const queries = ['PS5','iPhone 17','PS5 disc drive','ايفون 17 256 جيجا','لابتوب hp','Nike','Logitech mouse','بلايستيشن 5 جهاز','iPhone 17 case','Samsung Galaxy S25 Ultra 256GB','HP','ايفون 17 256 جيجا','iPhone 17 256GB','Sony','PS5 controller'];
for (const q of queries) {
  assert.deepStrictEqual(candidate.filterQueryOffers(q,offers),baseline.filterQueryOffers(q,offers),'filter parity: '+q);
  for (const offer of offers) {
    assert.deepStrictEqual(candidate.assessOfferMatch(q,offer),baseline.assessOfferMatch(q,offer),'match parity: '+q+' '+offer.title);
    assert.deepStrictEqual(candidate.queryMatchReasons(q,offer),baseline.queryMatchReasons(q,offer),'reasons parity: '+q+' '+offer.title);
  }
  assert.deepStrictEqual(candidate.filterQueryOffers(q,offers),baseline.filterQueryOffers(q,offers),'repeat parity: '+q);
}
const measuredQueries=['PS5','iPhone 17','HP laptop','Nike','iPhone 17 256GB','ايفون 17 256 جيجا'];
let checksum=0;
function measure(impl) {
  const start=performance.now();
  for(let i=0;i<2;i++)for(const q of measuredQueries)checksum+=impl.filterQueryOffers(q,offers).offers.length;
  return performance.now()-start;
}
measure(baseline);measure(candidate);
const timings={baseline:[],candidate:[]};
for(let round=0;round<6;round++){
  const order=round%2?['candidate','baseline']:['baseline','candidate'];
  for(const version of order)timings[version].push(Number(measure(version==='baseline'?baseline:candidate).toFixed(3)));
}
const median = a=>{const b=[...a].sort((x,y)=>x-y);return (b[2]+b[3])/2;};
const baseMs=median(timings.baseline),candidateMs=median(timings.candidate);
console.log('MATCH_FILTER_BENCHMARK '+JSON.stringify({
  queries:measuredQueries,offersPerQuery:offers.length,
  parityQueries:queries.length,parityOffers:offers.length,rounds:6,
  baselineMedianMs:baseMs,candidateMedianMs:candidateMs,
  relativeSpeedup:Number((baseMs/candidateMs).toFixed(3)),
  semanticallyEquivalent:true,checksum,timings
}));