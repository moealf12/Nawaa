// Bounded, read-only Noon offer comparison: existing Node catalog vs official storefront.
// Prints counts/diagnostics only; never logs SKU, customer details, product URLs or prices.
import { searchNoon } from "../server/providers/noon.mjs";
import { searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";

const queries=["ايفون 15","iPhone 17","PlayStation 5"];
const timeoutMs=15000;
for (const query of queries) {
  const results=await Promise.allSettled([
    Promise.race([searchNoon(query,12),new Promise((_,reject)=>setTimeout(()=>reject(Error("CATALOG_TIMEOUT")),timeoutMs))]),
    Promise.race([searchFreeStorefrontById("noon-sa",query,{perStore:12,catalogLimit:12,productPageLimit:3,storeDeadlineMs:10000}),new Promise((_,reject)=>setTimeout(()=>reject(Error("STOREFRONT_TIMEOUT")),timeoutMs))])
  ]);
  for (let index=0;index<results.length;index++) {
    const outcome=results[index],source=index===0?"node-catalog":"node-official-storefront";
    if(outcome.status==="rejected"){
      console.log(JSON.stringify({query,source,status:"FAILED",errorClass:String(outcome.reason?.message||"unknown").slice(0,120)}));
      continue;
    }
    const value=outcome.value;
    const offers=Array.isArray(value?.offers)?value.offers:[];
    const unique=new Set(offers.map(x=>String(x?.sourceMeta?.productId||x?.sku||x?.sourceUrl||"")));
    console.log(JSON.stringify({
      query,source,status:offers.length?"OFFERS_FOUND":"NO_OFFERS",
      offers:offers.length,uniqueProducts:unique.size,
      validSarPrices:offers.filter(x=>Number.isFinite(x?.productPrice)&&x.productPrice>0&&x.currency==="SAR").length,
      linkedNoon:offers.filter(x=>{try{return ["www.noon.com","noon.com"].includes(new URL(x.sourceUrl).hostname)}catch{return false}}).length,
      hasImages:offers.filter(x=>Boolean(x.image)).length,
      errors:(value?.errors||[]).map(x=>String(x?.error||x).slice(0,110)).slice(0,3)
    }));
  }
}
