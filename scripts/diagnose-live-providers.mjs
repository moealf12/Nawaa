// One-shot read-only source smoke test on GitHub-hosted runner.
// Important: a live product is a product with positive native price AND
// meaningful source URL/title. Never claim a source is healthy on transport alone.
// No credentials, paid APIs, DB writes or production mutations.
import {searchExtraUnbxd} from '../server/providers/extra-unbxd.mjs';
import {searchJarir} from '../server/providers/jarir.mjs';
import {searchSharafDG} from '../server/providers/sharafdg.mjs';
import {searchFreeStorefrontById} from '../server/providers/free-storefronts.mjs';

const cases=[
  ['extra-unbxd',()=>searchExtraUnbxd('iPhone 17',12,'iPhone 17')],
  ['jarir-direct',()=>searchJarir('iPhone 17',12,'iPhone 17')],
  ['sharafdg-algolia',()=>searchSharafDG('iPhone 17',12)],
  ['virgin-ae',()=>searchFreeStorefrontById('virgin-ae','iPhone 17',{
    matchingQuery:'iPhone 17',catalogLimit:12,productPageLimit:2,
    storeDeadlineMs:7000,perStore:12,
  })],
];
const timeoutMs=27000;
function summarizeError(x){return String(x?.error||x?.message||x).slice(0,160)}
async function testOne([sourceId,run]){
  const start=Date.now();
  try{
    let timeout;
    const result=await Promise.race([
      Promise.resolve().then(run),
      new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('diagnostic_deadline_exceeded')),timeoutMs)}),
    ]).finally(()=>clearTimeout(timeout));
    const offers=Array.isArray(result.offers)?result.offers:[];
    const good=offers.filter(o=>typeof o.title==='string'&&o.title.trim()&&
      Number.isFinite(o.productPrice)&&o.productPrice>0&&
      typeof o.sourceUrl==='string'&&o.sourceUrl.startsWith('https://'));
    return {
      sourceId,elapsedMs:Date.now()-start,ok:Boolean(result.ok),
      rawOffers:offers.length,wellFormedOffers:good.length,
      images:good.filter(o=>o.image||o.imageUrl).length,
      errors:(result.errors||[]).slice(0,12).map(summarizeError),
      evidence:good.slice(0,5).map(o=>({
        title:String(o.title).slice(0,105),price:o.productPrice,currency:o.currency,
        merchant:o.merchant,urlHost:new URL(o.sourceUrl).hostname,
      })),
      diagnostics:result.diagnostics?.queryFilter?{
        filtered:result.diagnostics.queryFilter,
        pagination:result.diagnostics.pagination,
      }:undefined,
    };
  }catch(error){return {
    sourceId,elapsedMs:Date.now()-start,ok:false,rawOffers:0,wellFormedOffers:0,
    errors:[summarizeError(error)],
  }}
}
const result=await Promise.all(cases.map(testOne));
for(const item of result)console.log('LIVE_PROVIDER_DIAGNOSTIC '+JSON.stringify(item));
console.log('LIVE_PROVIDER_SUMMARY '+JSON.stringify({
  sourceCount:result.length,productiveSources:result.filter(x=>x.wellFormedOffers>0).length,
  wellFormedOffers:result.reduce((s,x)=>s+x.wellFormedOffers,0),
  transportFailures:result.filter(x=>x.errors?.length&&x.wellFormedOffers===0).map(x=>x.sourceId)
}));
// Diagnostic-only: a zero-yield response is a test RESULT, not CI pass evidence.
