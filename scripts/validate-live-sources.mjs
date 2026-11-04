import { searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";
import {searchJarir} from "../server/providers/jarir.mjs";
import {searchExtraUnbxd} from "../server/providers/extra-unbxd.mjs";
import {searchSharafDG} from "../server/providers/sharafdg.mjs";

const CASES = [
  // Saudi/GCC certification batch: prioritize sources that can materially
  // increase shopper recall before the wider global validation matrix.
  ["amazon-sa","iphone 17"],["lulu-sa","iphone 17"],["samsung-sa","galaxy s25"],
  // EU discovery pilots: a PROBED result is not proof of a sale, Saudi shipping,
  // landed cost, or reliable ongoing source access.
  ["amazon-uk","iphone 17"],["amazon-de","iphone 17"],
  ["mediamarkt-de","iphone 17"],["pccomponentes-es","iphone 17"],
  ["bike24-de","running shoes"],["thomann-de","studio headphones"],
  ["virgin-sa","airpods"],["amazon-ae","iphone 17"],["noon-ae","iphone 17"],
  ["sharafdg-ae","hp laptop"],["virgin-ae","iphone 17"],["virgin-ae","airpods"],["virgin-ae","apple watch"],["virgin-ae","macbook"],["virgin-ae","playstation 5"],["xcite-kw","hp laptop"],
  ["lulu-ae","iphone 17"],["carrefour-ae","iphone 17"],["microless-ae","iphone 17"],["jumbo-ae","iphone 17"],
  ["goldenscent-sa","dior sauvage"],["ounass-sa","nike shoes"],["sunandsand-sa","nike shoes"],
  ["virgin-sa","airpods"],["homecentre-sa","office chair"],["mumzworld-sa","stroller"],
  ["asos-global","nike air max"],["farfetch-sa","gucci shoes"],["etsy-global","silver necklace"],
  ["newegg-global","gaming laptop"],["bhphoto-us","canon camera"],["walmart-us","airpods"],
  ["bestbuy-us","apple airpods 4"],["nike-sa","nike shoes"],["adidas-sa","adidas shoes"],
  ["sephora-sa","dior perfume"],["namshi-sa","nike v5 runner"],["centrepoint-sa","leather chair"],
  ["maxfashion-sa","shoes"],["decathlon-sa","running shoes"],["niceone-sa","dior perfume"],
  ["netaporter-global","nike shoes"],["mrporter-global","nike shoes"],["mytheresa-global","gucci shoes"],
  ["ssense-global","nike shoes"],["jomashop-global","seiko watch"],["fragrancex-global","dior perfume"],
  ["lookfantastic-global","cerave cleanser"],["cultbeauty-global","niod serum"],["stockx-global","nike shoes"],["goat-global","nike shoes"],
  ["amazon-ae","airpods"],["noon-ae","airpods"],["sharafdg-ae","airpods"],
  ["virgin-ae","airpods"],["xcite-kw","airpods"],["lulu-ae","airpods"],
];

// Native provider adapters already participate in customer search. They are
// independent merchants, not replays of the NAWAA API or alias names for free
// storefronts. Keep native and free-storefront counts separately inspectable.
const NATIVE_CASES=[
  ["jarir-sa","iphone 17",q=>searchJarir(q,12,q,{signal:AbortSignal.timeout(11000)})],
  ["extra-sa","iphone 17",q=>searchExtraUnbxd(q,12,q,{signal:AbortSignal.timeout(11000)})],
  ["sharafdg-sa","iphone 17",q=>searchSharafDG(q,12,{signal:AbortSignal.timeout(11000)})],
];
const validOffers=offers=>offers.filter(o=>
  typeof o.title==="string" && o.title.trim().length>=3 &&
  typeof o.sourceUrl==="string" && /^https:\/\//i.test(o.sourceUrl) &&
  typeof o.image==="string" && /^https?:\/\//i.test(o.image) &&
  Number.isFinite(o.productPrice) && o.productPrice>0
);
let validatedCases = 0;
const rows = [];
for (const [store, query] of CASES) {
  const started = Date.now();
  try {
    const result = await searchFreeStorefrontById(store, query, { perStore: 3 });
    const offers = result.offers || [];
    // SKU is useful identity metadata, but it is not a requirement for a usable price result.
    // A live source must return the shopper-facing essentials: product, URL, image and price.
    const valid = validOffers(offers);
    const status = valid.length ? "LIVE_VALIDATED" : "PROBED";
    if (valid.length) validatedCases++;
    rows.push({store,query,status,candidates:result.candidates,offers:offers.length,valid:valid.length,ms:Date.now()-started,error:result.diagnostics?.primarySearchError || null,
      candidateSamples:result.diagnostics?.candidateSamples || [],
      failureSamples:result.diagnostics?.failureSamples || [],
      unpricedSamples:result.diagnostics?.unpricedSamples || [],
      queryFilter:result.diagnostics?.queryFilter || null,
      // Preserve bounded source-provided rejection evidence. Without these
      // first-five titles/reasons a 51→0 Amazon run cannot distinguish a
      // relevance filter from a source response change.
      queryFilterSamples:result.diagnostics?.queryFilterSamples || []});
  } catch (error) {
    rows.push({store,query,status:"PROBED_FAILED",candidates:0,offers:0,valid:0,ms:Date.now()-started,error:error?.message || String(error)});
  }
}
for(const [store,query,search] of NATIVE_CASES){
  const started=Date.now();
  try{
    const result=await search(query);
    const offers=Array.isArray(result?.offers)?result.offers:[];
    const valid=validOffers(offers);
    const status=valid.length?"LIVE_VALIDATED":"PROBED";
    if(valid.length)validatedCases++;
    rows.push({store,query,adapter:"NATIVE_SAUDI_LIVE",status,candidates:offers.length,
      offers:offers.length,valid:valid.length,ms:Date.now()-started,
      error:(result?.errors||[]).map(e=>String(e?.error||"").slice(0,120)).filter(Boolean).slice(0,3)});
  }catch(error){
    rows.push({store,query,adapter:"NATIVE_SAUDI_LIVE",status:"PROBED_FAILED",
      candidates:0,offers:0,valid:0,ms:Date.now()-started,
      error:String(error?.message||error).slice(0,160)});
  }
}
console.table(rows);
const failed = rows.filter((row) => row.status === "PROBED_FAILED").length;
const probedOnly = rows.filter((row) => row.status === "PROBED").length;
// Distinct merchants, not the number of passing query/merchant pairs.
// Repeating a single accessible merchant must never manufacture breadth.
const liveSources = [...new Set(rows
  .filter(row=>row.status==="LIVE_VALIDATED").map(row=>row.store))].sort();
const uniqueLiveStores = liveSources.length;
const freeStorefrontLiveStores=liveSources.filter(id=>!NATIVE_CASES.some(([native])=>native===id));
const nativeLiveStores=liveSources.filter(id=>NATIVE_CASES.some(([native])=>native===id));
const report = {
  checked:CASES.length+NATIVE_CASES.length,
  freeStorefrontChecked:CASES.length,nativeChecked:NATIVE_CASES.length,
  freeStorefrontLiveStores,nativeLiveStores,
  liveValidated:uniqueLiveStores,
  liveValidatedCases:validatedCases,
  uniqueLiveStores,
  liveSources,probedOnly,failed,rows,
  evidenceMode:"REAL_PUBLIC_MERCHANT_HTTP_ONLY",
  coverageScope:"DISTINCT_NATIVE_AND_FREE_STOREFRONT_MERCHANTS",
  sourceCoverageCertified:uniqueLiveStores>=Number(process.env.MIN_LIVE_SOURCES||8),
};
console.log(JSON.stringify(report,null,2));
await import("node:fs").then(({writeFileSync}) => writeFileSync("live-source-validation.json", JSON.stringify(report,null,2)));
const minimumLive = Number(process.env.MIN_LIVE_SOURCES || 8);
if (uniqueLiveStores < minimumLive) {
  console.error(`VALIDATION_GATE_FAILED: ${uniqueLiveStores}/${minimumLive} unique live stores; ${validatedCases} validated query-store observations.`);
  process.exitCode = 1;
}
