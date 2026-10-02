import { searchFreeStorefrontById, configuredFreeStorefronts } from "./providers/free-storefronts.mjs";

const DEFAULT_QUERIES = {
  "shein-sa":"dress", "aliexpress-cn":"iphone 17 case", "temu-global":"iphone 17 case",
  "iherb-sa":"vitamin c", "ikea-sa":"chair", "asos-global":"nike shoes",
  "farfetch-sa":"gucci bag", "etsy-global":"silver necklace", "newegg-global":"laptop",
  "bhphoto-us":"sony camera", "walmart-us":"iphone", "bestbuy-us":"laptop",
  "adidas-sa":"running shoes", "nike-sa":"running shoes", "sephora-sa":"dior perfume",
  "namshi-sa":"nike shoes", "centrepoint-sa":"dress", "maxfashion-sa":"dress",
  "decathlon-sa":"running shoes", "niceone-sa":"dior perfume",
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
  const results = [];
  for (const store of stores) {
    const probeQuery = query || DEFAULT_QUERIES[store.id] || store.name;
    const started = Date.now();
    try {
      const result = await searchFreeStorefrontById(store.id, probeQuery, { perStore:100 });
      const status = result?.diagnostics?.primarySearchError && !result?.offers?.length
        ? "FAILING"
        : classify(result);
      results.push({
        id:store.id, name:store.name, query:probeQuery, status,
        candidates:result.candidates, verifiedOffers:result.offers.length, failures:result.failures,
        durationMs:Date.now()-started,
        diagnostics:result.diagnostics || null,
        sampleOffers:result.offers.slice(0,3).map(offer=>({
          title:offer.title, price:offer.productPrice, currency:offer.currency,
          merchant:offer.merchant, sourceUrl:offer.sourceUrl,
        })),
      });
    } catch (error) {
      results.push({
        id:store.id, name:store.name, query:probeQuery, status:"FAILING",
        candidates:0, verifiedOffers:0, failures:1, durationMs:Date.now()-started,
        error:error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    observedAt:new Date().toISOString(),
    audited:results.length,
    liveVerified:results.filter(item=>item.status==="LIVE_VERIFIED").length,
    results,
  };
}
