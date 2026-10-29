import { searchFreeStorefrontById, configuredFreeStorefronts } from "./providers/free-storefronts.mjs";
import {classifySourceError} from "../src/source-access-intelligence.mjs";
import { searchExtraUnbxd } from "./providers/extra-unbxd.mjs";
import { searchJarir } from "./providers/jarir.mjs";
import { searchSharafDG } from "./providers/sharafdg.mjs";
import { searchSwarovskiSaudi } from "./providers/swarovski.mjs";

const DEFAULT_QUERIES = {
  "shein-sa":"dress", "aliexpress-cn":"iphone 17 case", "temu-global":"iphone 17 case",
  "iherb-sa":"vitamin c", "ikea-sa":"chair", "asos-global":"nike shoes",
  "farfetch-sa":"gucci bag", "etsy-global":"silver necklace", "newegg-global":"laptop",
  "bhphoto-us":"sony camera", "walmart-us":"iphone", "bestbuy-us":"laptop",
  "adidas-sa":"running shoes", "nike-sa":"running shoes", "sephora-sa":"dior perfume",
  "namshi-sa":"nike shoes", "centrepoint-sa":"dress", "maxfashion-sa":"dress",
  "decathlon-sa":"running shoes", "niceone-sa":"dior perfume",
  "amazon-sa":"hp laptop", "amazon-ae":"hp laptop", "noon-ae":"iphone",
  // Product-intent probes, not the seller's name. These certify no Saudi delivery.
  "amazon-uk":"iphone 17", "amazon-de":"iphone 17", "mediamarkt-de":"iphone 17",
  "pccomponentes-es":"iphone 17", "bike24-de":"running shoes",
  "thomann-de":"studio headphones",
  "sharafdg-ae":"hp laptop", "virgin-ae":"iphone", "xcite-kw":"hp laptop", "lulu-ae":"iphone",
  "lulu-sa":"iphone 17", "samsung-sa":"galaxy s25", "carrefour-ae":"iphone 17",
  "microless-ae":"iphone 17", "jumbo-ae":"iphone 17",
  "goldenscent-sa":"dior perfume", "ounass-sa":"gucci bag", "sunandsand-sa":"running shoes",
  "virgin-sa":"iphone", "homecentre-sa":"chair", "mumzworld-sa":"baby stroller",
  "netaporter-global":"gucci bag", "mrporter-global":"nike shoes", "mytheresa-global":"gucci bag",
  "ssense-global":"nike shoes", "jomashop-global":"seiko watch", "fragrancex-global":"dior perfume",
  "lookfantastic-global":"dior perfume", "cultbeauty-global":"dior perfume",
  "stockx-global":"nike shoes", "goat-global":"nike shoes",
  "extra":"iphone 17", "jarir":"hp laptop",
  "sharafdg-sa":"iphone 17", "swarovski-sa":"bracelet",
};

function classify(result) {
  if (result?.offers?.length > 0) return "LIVE_VERIFIED";
  if (result?.candidates > 0 && result?.failures >= result.candidates) return "BLOCKED_OR_RESOLUTION_FAILED";
  if (result?.candidates > 0) return "CONNECTED_NO_VERIFIED_PRICE";
  return "CONNECTED_NO_CANDIDATES";
}

// Core merchant APIs are not free-storefront HTML adapters. The source audit
// matrix explicitly names these IDs, so probe their REAL adapters rather than
// throwing "unknown storefront" before any source request is attempted.
const DIRECT_AUDIT_SOURCES = {
  extra:{name:"eXtra",countryCode:"SA",run:q=>searchExtraUnbxd(q,24,q)},
  jarir:{name:"Jarir",countryCode:"SA",run:q=>searchJarir(q,24,q)},
  "sharafdg-sa":{name:"Sharaf DG",countryCode:"SA",run:q=>searchSharafDG(q,24)},
  "swarovski-sa":{name:"Swarovski",countryCode:"SA",run:q=>searchSwarovskiSaudi(q,24)},
};

function directAuditOfferValid(offer) {
  if(typeof offer?.title!=="string" || !offer.title.trim()) return false;
  if(!Number.isFinite(offer.productPrice) || offer.productPrice<=0) return false;
  if(!/^[A-Z]{3}$/.test(offer.currency||"")) return false;
  try{return new URL(offer.sourceUrl).protocol==="https:"}catch{return false}
}

async function auditDirectSource(storeId, query, adapter) {
  const started=Date.now();
  let item;
  try {
    const raw=await adapter.run(query);
    const all=Array.isArray(raw?.offers)?raw.offers:[];
    const offers=all.filter(directAuditOfferValid);
    item={
      id:storeId,name:adapter.name,countryCode:adapter.countryCode,query,
      status:offers.length?"LIVE_VERIFIED":all.length?"CONNECTED_NO_VERIFIED_PRICE":raw?.errors?.length?"FAILING":"CONNECTED_NO_CANDIDATES",
      candidates:all.length,verifiedOffers:offers.length,failures:raw?.errors?.length||0,
      durationMs:Date.now()-started,
      diagnostics:{adapter:"direct",rawOffers:all.length,providerDiagnostics:raw?.diagnostics||null,
        errors:(raw?.errors||[]).slice(0,8)},
      sampleOffers:offers.slice(0,3).map(offer=>({
        title:offer.title,price:offer.productPrice,currency:offer.currency,
        merchant:offer.merchant,sourceUrl:offer.sourceUrl,
      })),
    };
  }catch(error){
    item={
      id:storeId,name:adapter.name,countryCode:adapter.countryCode,query,
      status:"FAILING",candidates:0,verifiedOffers:0,failures:1,
      durationMs:Date.now()-started,
      error:error instanceof Error?error.message:String(error),
    };
  }
  return {
    observedAt:new Date().toISOString(),audited:1,
    liveVerified:Number(item.status==="LIVE_VERIFIED"),
    failing:Number(item.status==="FAILING"),totalVerifiedOffers:item.verifiedOffers,
    slowest:[{id:item.id,durationMs:item.durationMs,status:item.status}],
    results:[item],
  };
}

export async function auditFreeStorefronts({ storeId = null, query = null, directSources = DIRECT_AUDIT_SOURCES } = {}) {
  const stores = configuredFreeStorefronts().filter(store => !storeId || store.id === storeId);
  if(storeId && !stores.length && directSources[storeId]) {
    return auditDirectSource(storeId,query || DEFAULT_QUERIES[storeId] || storeId,directSources[storeId]);
  }
  if (storeId && stores.length === 0) throw new Error("unknown storefront: " + storeId);

  // Keep full source coverage while bounding simultaneous network-heavy probes.
  // Unbounded fan-out made individually healthy stores time out under contention.
  const concurrency = Math.max(1, Math.min(Number(process.env.NAWAA_AUDIT_CONCURRENCY) || 6, stores.length || 1));
  const results = new Array(stores.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= stores.length) return;
      const store = stores[index];
    const probeQuery = query || DEFAULT_QUERIES[store.id] || store.name;
    const started = Date.now();
    let resultItem;
    try {
      // Initial EU probes: cap PDP resolution on unproven merchant adapters.
      const isEuropeanPilot = ["amazon-uk","amazon-de","mediamarkt-de",
        "pccomponentes-es","bike24-de","thomann-de"].includes(store.id);
      const result = await searchFreeStorefrontById(store.id, probeQuery, {
        perStore:isEuropeanPilot ? 3 : 100,
        noonSearchCardDiagnostics:store.id==="noon-sa",
      });
      const status = result?.diagnostics?.primarySearchError && !result?.offers?.length
        ? "FAILING"
        : classify(result);
      resultItem = {
        id:store.id, name:store.name, countryCode:store.countryCode, query:probeQuery, status,
        candidates:result.candidates, verifiedOffers:result.offers.length, failures:result.failures,
        durationMs:Date.now()-started,
        diagnostics:result.diagnostics || null,
        sampleOffers:result.offers.slice(0,3).map(offer=>({
          title:offer.title, price:offer.productPrice, currency:offer.currency,
          merchant:offer.merchant, sourceUrl:offer.sourceUrl,
        })),
      };
    } catch (error) {
      const failure=classifySourceError(error);
      const failureClass=typeof failure?.failureClass==="string"
        ? failure.failureClass : "SOURCE_FAILURE";
      resultItem = {
        id:store.id, name:store.name, countryCode:store.countryCode, query:probeQuery, status:"FAILING",
        candidates:0, verifiedOffers:0, failures:1, durationMs:Date.now()-started,
        // A denied source has unknown availability, never zero real inventory.
        ...(store.id==="noon-sa" ? {
          failureClass,productAvailability:"unknown",customerPublishable:false,
          error:"noon_source_"+failureClass.toLowerCase(),
        } : {error:error instanceof Error ? error.message : String(error)}),
      };
    }
  
      results[index] = resultItem;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    observedAt:new Date().toISOString(),
    audited:results.length,
    liveVerified:results.filter(item=>item.status==="LIVE_VERIFIED").length,
    failing:results.filter(item=>item.status==="FAILING").length,
    totalVerifiedOffers:results.reduce((sum,item)=>sum+(item.verifiedOffers||0),0),
    slowest:[...results].sort((a,b)=>b.durationMs-a.durationMs).slice(0,10).map(({id,durationMs,status})=>({id,durationMs,status})),
    results,
  };
}
