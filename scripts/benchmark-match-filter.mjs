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
// v15.3 intentionally corrects Arabic phone covers previously accepted as
// complete iPhones. Only this documented fixture is excluded from cross-version
// strict parity; all other 95 offers must match under all 15 queries.
const knownArabicCover = 'غطاء هاتف ايفون 17 اسود';
const intentional = offers.filter(offer=>offer.title===knownArabicCover);
const unaffected = offers.filter(offer=>offer.title!==knownArabicCover);
assert.ok(intentional.length>0,'must exercise the known false-positive title');
for (const offer of offers) {
  assert.deepStrictEqual(candidate.describeProduct(offer),baseline.describeProduct(offer),'description parity: '+offer.title);
  assert.deepStrictEqual(candidate.productCategory(offer),baseline.productCategory(offer),'category parity: '+offer.title);
}
for (const q of queries) {
  assert.deepStrictEqual(candidate.filterQueryOffers(q,unaffected),baseline.filterQueryOffers(q,unaffected),'unaffected filter parity: '+q);
  for (const offer of unaffected) {
    assert.deepStrictEqual(candidate.assessOfferMatch(q,offer),baseline.assessOfferMatch(q,offer),'unaffected match parity: '+q+' '+offer.title);
    assert.deepStrictEqual(candidate.queryMatchReasons(q,offer),baseline.queryMatchReasons(q,offer),'unaffected reasons parity: '+q+' '+offer.title);
  }
  assert.deepStrictEqual(candidate.filterQueryOffers(q,unaffected),baseline.filterQueryOffers(q,unaffected),'repeat unaffected parity: '+q);
}
const iphoneBefore = baseline.filterQueryOffers('iPhone 17',offers).offers;
const iphoneAfter = candidate.filterQueryOffers('iPhone 17',offers).offers;
assert.ok(iphoneBefore.some(o=>o.title===knownArabicCover),
  'historical baseline must reproduce the false positive');
assert.ok(!iphoneAfter.some(o=>o.title===knownArabicCover),
  'candidate must reject Arabic covers from a bare iPhone search');
assert.deepStrictEqual(iphoneAfter.map(o=>o.sourceUrl),
  iphoneBefore.filter(o=>o.title!==knownArabicCover).map(o=>o.sourceUrl),
  'candidate must remove only known Arabic cover offers from iPhone results');
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
  semanticallyEquivalent:false,unaffectedOfferParity:true,
  intentionalChange:{reason:'Arabic covers no longer falsely match iPhone 17 handsets',
    excludedOfferCount:iphoneBefore.length-iphoneAfter.length,fixtureCount:intentional.length},
  checksum,timings
}));