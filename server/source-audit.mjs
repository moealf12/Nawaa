import { searchFreeStorefrontById, configuredFreeStorefronts } from "./providers/free-storefronts.mjs";
import { searchJarir } from "./providers/jarir.mjs";
import { searchExtraUnbxd } from "./providers/extra-unbxd.mjs";
import { searchSharafDG } from "./providers/sharafdg.mjs";
import { searchSwarovskiSaudi } from "./providers/swarovski.mjs";
import { searchEbayWorldwide, ebayConfigured } from "./providers/ebay.mjs";
import { configuredShopifyStores, searchShopifyStore } from "./providers/shopify.mjs";

const FREE_STORE_ALIASES = new Map([["newegg-us","newegg-global"],["bhphoto","bhphoto-us"]]);

const DIRECT_STORES = [
  { id:"jarir", name:"Jarir", countryCode:"SA", search:(q)=>searchJarir(q,100,q) },
  { id:"extra", name:"eXtra", countryCode:"SA", search:(q)=>searchExtraUnbxd(q,100,q) },
  { id:"sharafdg-sa", name:"Sharaf DG Saudi", countryCode:"SA", search:(q)=>searchSharafDG(q) },
  { id:"swarovski-sa", name:"Swarovski Saudi", countryCode:"SA", search:(q)=>searchSwarovskiSaudi(/\\bswarovski\\b/i.test(q)?q:`Swarovski ${q}`) },
  ...(ebayConfigured() ? [{ id:"ebay", name:"eBay", countryCode:"US", search:(q)=>searchEbayWorldwide(q,{marketLimit:4,perMarket:5}) }] : []),
  ...configuredShopifyStores().map((store)=>({
    id:`shopify:${store.id || store.name}`,
    name:store.name,
    countryCode:String(store.countryCode || "").toUpperCase(),
    search:(q)=>searchShopifyStore(q,store,{limit:5}),
  })),
];

const DEFAULT_QUERIES = {
  "shein-sa":"dress", "aliexpress-cn":"iphone 17 case", "temu-global":"iphone 17 case",
  "iherb-sa":"vitamin c", "ikea-sa":"chair", "asos-global":"nike shoes",
  "farfetch-sa":"gucci bag", "etsy-global":"silver necklace", "newegg-global":"laptop",
  "bhphoto-us":"sony camera", "walmart-us":"iphone", "bestbuy-us":"laptop",
  "adidas-sa":"running shoes", "nike-sa":"running shoes", "sephora-sa":"dior perfume",
  "namshi-sa":"nike shoes", "centrepoint-sa":"dress", "maxfashion-sa":"dress",
  "decathlon-sa":"running shoes", "niceone-sa":"dior perfume",
  "amazon-sa":"hp laptop", "amazon-ae":"hp laptop", "noon-ae":"iphone",
  "sharafdg-ae":"hp laptop", "virgin-ae":"iphone", "xcite-kw":"hp laptop", "lulu-ae":"iphone",
  "lulu-sa":"iphone 17", "samsung-sa":"galaxy s25", "carrefour-ae":"iphone 17",
  "microless-ae":"iphone 17", "jumbo-ae":"iphone 17",
  "goldenscent-sa":"dior perfume", "ounass-sa":"gucci bag", "sunandsand-sa":"running shoes",
  "virgin-sa":"iphone", "homecentre-sa":"chair", "mumzworld-sa":"baby stroller",
  "netaporter-global":"gucci bag", "mrporter-global":"nike shoes", "mytheresa-global":"gucci bag",
  "ssense-global":"nike shoes", "jomashop-global":"seiko watch", "fragrancex-global":"dior perfume",
  "lookfantastic-global":"dior perfume", "cultbeauty-global":"dior perfume",
  "stockx-global":"nike shoes", "goat-global":"nike shoes",
};

function classify(result) {
  if (result?.offers?.length > 0) return "LIVE_VERIFIED";
  if (result?.candidates > 0 && result?.failures >= result.candidates) return "BLOCKED_OR_RESOLUTION_FAILED";
  if (result?.candidates > 0) return "CONNECTED_NO_VERIFIED_PRICE";
  return "CONNECTED_NO_CANDIDATES";
}

export async function auditFreeStorefronts({ storeId = null, query = null } = {}) {
  const aliasedFreeStores = configuredFreeStorefronts().flatMap((store)=>{
    const aliases=[...FREE_STORE_ALIASES.entries()].filter(([,target])=>target===store.id).map(([alias])=>({...store,id:alias}));
    return [store,...aliases];
  });
  const stores = [...DIRECT_STORES, ...aliasedFreeStores]
    .filter((store,index,all)=>all.findIndex((candidate)=>candidate.id===store.id)===index)
    .filter(store => !storeId || store.id === storeId);
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
      const direct = DIRECT_STORES.find((entry)=>entry.id===store.id);
      const freeStoreId = FREE_STORE_ALIASES.get(store.id) || store.id;
      const result = direct
        ? await direct.search(probeQuery)
        : await searchFreeStorefrontById(freeStoreId, probeQuery, { perStore:100 });
      const status = result?.diagnostics?.primarySearchError && !result?.offers?.length
        ? "FAILING"
        : classify(result);
      resultItem = {
        id:store.id, name:store.name, countryCode:store.countryCode, query:probeQuery, status,
        candidates:Number.isFinite(result.candidates) ? result.candidates : result.offers.length, verifiedOffers:result.offers.length, failures:Number.isFinite(result.failures) ? result.failures : (Array.isArray(result.errors) ? result.errors.length : 0),
        durationMs:Date.now()-started,
        diagnostics:result.diagnostics || null,
        sampleOffers:result.offers.slice(0,3).map(offer=>({
          title:offer.title, price:offer.productPrice, currency:offer.currency,
          merchant:offer.merchant, sourceUrl:offer.sourceUrl,
        })),
      };
    } catch (error) {
      resultItem = {
        id:store.id, name:store.name, countryCode:store.countryCode, query:probeQuery, status:"FAILING",
        candidates:0, verifiedOffers:0, failures:1, durationMs:Date.now()-started,
        error:error instanceof Error ? error.message : String(error),
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
