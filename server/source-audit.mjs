import { searchFreeStorefrontById, configuredFreeStorefronts } from "./providers/free-storefronts.mjs";

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
  const stores = configuredFreeStorefronts().filter(store => !storeId || store.id === storeId);
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
      const result = await searchFreeStorefrontById(store.id, probeQuery, { perStore:100 });
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
