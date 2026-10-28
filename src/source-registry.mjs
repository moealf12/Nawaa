// NAWAA global source registry.
// "candidate" means the merchant/market is a discovery target, not yet an active adapter.
// Saudi delivery must be verified per offer before an item can be ranked.


/** First-party Decathlon merchant is excluded from all NAWAA discovery sources. */
export function isExcludedMerchantSource(store) {
  const id=String(store?.id || "").trim().toLowerCase();
  const name=String(store?.name || "").trim().toLowerCase();
  if (id==="decathlon" || id.startsWith("decathlon-") ||
      name==="decathlon" || name.startsWith("decathlon ")) return true;
  try {
    const hostname=new URL(String(store?.baseUrl || store?.url || "")).hostname.toLowerCase();
    return /(^|\.)decathlon\.[a-z0-9-]+(?:\.[a-z0-9-]+)?$/.test(hostname);
  } catch { return false; }
}

export const WORLD_SOURCE_REGISTRY = [
  // Saudi Arabia / GCC
  { id: "amazon-sa", name: "Amazon.sa", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "noon-sa", name: "Noon Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "jarir", name: "Jarir", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "extra", name: "eXtra", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "amazon-ae", name: "Amazon.ae", countryCode: "AE", region: "MENA", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "noon-ae", name: "Noon UAE", countryCode: "AE", region: "MENA", status: "candidate", saudiDelivery: "offer_dependent" },

  { id: "sharafdg-sa", name: "Sharaf DG Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "swarovski-sa", name: "Swarovski Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "carrefour-sa", name: "Carrefour Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "shein-sa", name: "SHEIN", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "ikea-sa", name: "IKEA Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "adidas-sa", name: "adidas Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "nike-sa", name: "Nike Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "sephora-sa", name: "Sephora Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "namshi-sa", name: "Namshi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "centrepoint-sa", name: "Centrepoint", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "maxfashion-sa", name: "Max Fashion", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "niceone-sa", name: "Nice One", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },

  // North America
  { id: "amazon-us", name: "Amazon.com", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "ebay", name: "eBay", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "seller_dependent" },
  { id: "newegg-us", name: "Newegg", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "verified_market" },
  { id: "bhphoto", name: "B&H Photo", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "verified_market" },
  { id: "walmart-us", name: "Walmart", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "unknown" },
  { id: "bestbuy-us", name: "Best Buy", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "unknown" },
  { id: "etsy-global", name: "Etsy", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "seller_dependent" },
  { id: "iherb-sa", name: "iHerb", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "verified_market" },
  { id: "amazon-ca", name: "Amazon.ca", countryCode: "CA", region: "North America", status: "candidate", saudiDelivery: "offer_dependent" },

  // United Kingdom / Europe
  { id: "amazon-uk", name: "Amazon.co.uk", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "currys", name: "Currys", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "asos-global", name: "ASOS", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "farfetch-sa", name: "Farfetch", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "argos", name: "Argos", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-de", name: "Amazon.de", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "mediamarkt-de", name: "MediaMarkt Germany", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "no_direct" },
  { id: "kaufland-de", name: "Kaufland", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-fr", name: "Amazon.fr", countryCode: "FR", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "fnac-fr", name: "Fnac", countryCode: "FR", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "cdiscount-fr", name: "Cdiscount", countryCode: "FR", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-it", name: "Amazon.it", countryCode: "IT", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "amazon-es", name: "Amazon.es", countryCode: "ES", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "pccomponentes-es", name: "PcComponentes", countryCode: "ES", region: "Europe", status: "candidate", saudiDelivery: "no_direct" },
  // European merchant acquisition targets. A shipping route at store level
  // never certifies that a particular SKU can be purchased into Saudi Arabia.
  { id: "bike24-de", name: "BIKE24", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "verified_market" },
  { id: "thomann-de", name: "Thomann", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "coolblue-nl", name: "Coolblue", countryCode: "NL", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "alternate-de", name: "Alternate", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "computeruniverse-de", name: "Computeruniverse", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "alza-cz", name: "Alza", countryCode: "CZ", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "tradeinn-es", name: "Tradeinn", countryCode: "ES", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "sportsdirect-uk", name: "Sports Direct", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "end-uk", name: "END.", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "yoox-it", name: "YOOX", countryCode: "IT", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "ebay-uk", name: "eBay UK marketplace", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "seller_dependent" },
  // Comparison indexes are merchant-discovery intelligence, NEVER an
  // independently sellable merchant offer or proof of a Saudi landed price.
  { id: "geizhals-de", name: "Geizhals", countryCode: "DE", region: "Europe", sourceKind: "price_discovery_index", status: "candidate", saudiDelivery: "not_applicable" },
  { id: "idealo-de", name: "idealo", countryCode: "DE", region: "Europe", sourceKind: "price_discovery_index", status: "candidate", saudiDelivery: "not_applicable" },

  { id: "bol", name: "bol", countryCode: "NL", region: "Europe", status: "candidate", saudiDelivery: "local_market" },
  { id: "allegro-pl", name: "Allegro", countryCode: "PL", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "allegro-cz", name: "Allegro.cz", countryCode: "CZ", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "allegro-sk", name: "Allegro.sk", countryCode: "SK", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "allegro-hu", name: "Allegro.hu", countryCode: "HU", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "emag-ro", name: "eMAG", countryCode: "RO", region: "Europe", status: "candidate", saudiDelivery: "unknown" },

  // East / South / Southeast Asia
  { id: "amazon-jp", name: "Amazon.co.jp", countryCode: "JP", region: "Asia", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "rakuten-jp", name: "Rakuten Ichiba", countryCode: "JP", region: "Asia", status: "candidate", saudiDelivery: "forwarding_or_unknown" },
  { id: "yodobashi-jp", name: "Yodobashi", countryCode: "JP", region: "Asia", status: "candidate", saudiDelivery: "unknown" },
  { id: "biccamera-jp", name: "Bic Camera", countryCode: "JP", region: "Asia", status: "candidate", saudiDelivery: "unknown" },
  { id: "gmarket-kr", name: "Gmarket", countryCode: "KR", region: "Asia", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "coupang-kr", name: "Coupang", countryCode: "KR", region: "Asia", status: "candidate", saudiDelivery: "unknown" },
  { id: "aliexpress-cn", name: "AliExpress", countryCode: "CN", region: "Asia", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "temu-global", name: "Temu", countryCode: "CN", region: "Asia", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "jd-cn", name: "JD", countryCode: "CN", region: "Asia", status: "candidate", saudiDelivery: "unknown" },
  { id: "tmall-cn", name: "Tmall", countryCode: "CN", region: "Asia", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-in", name: "Amazon.in", countryCode: "IN", region: "Asia", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "flipkart-in", name: "Flipkart", countryCode: "IN", region: "Asia", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-sg", name: "Amazon.sg", countryCode: "SG", region: "Asia", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "lazada-sg", name: "Lazada", countryCode: "SG", region: "Asia", status: "candidate", saudiDelivery: "unknown" },
  { id: "shopee-sg", name: "Shopee", countryCode: "SG", region: "Asia", status: "candidate", saudiDelivery: "unknown" },

  // Oceania
  { id: "amazon-au", name: "Amazon.com.au", countryCode: "AU", region: "Oceania", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "jbhifi-au", name: "JB Hi-Fi", countryCode: "AU", region: "Oceania", status: "candidate", saudiDelivery: "unknown" },

  // Latin America
  { id: "mercadolibre-mx", name: "Mercado Libre", countryCode: "MX", region: "Latin America", status: "candidate", saudiDelivery: "local_market" },
  { id: "mercadolibre-br", name: "Mercado Livre", countryCode: "BR", region: "Latin America", status: "candidate", saudiDelivery: "local_market" },
  { id: "mercadolibre-ar", name: "Mercado Libre", countryCode: "AR", region: "Latin America", status: "candidate", saudiDelivery: "local_market" },
  { id: "mercadolibre-cl", name: "Mercado Libre", countryCode: "CL", region: "Latin America", status: "candidate", saudiDelivery: "local_market" },
  { id: "mercadolibre-co", name: "Mercado Libre", countryCode: "CO", region: "Latin America", status: "candidate", saudiDelivery: "local_market" },

  // Africa
  { id: "amazon-eg", name: "Amazon.eg", countryCode: "EG", region: "Africa", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "takealot-za", name: "Takealot", countryCode: "ZA", region: "Africa", status: "candidate", saudiDelivery: "unknown" },
];

export function sourceCoverageSummary(registry = WORLD_SOURCE_REGISTRY) {
  return {
    sources: registry.length,
    configuredSources: registry.filter(source => source.status === "configured").length,
    disabledSources: registry.filter(source => source.status === "disabled").length,
    candidateSources: registry.filter(source => source.status === "candidate").length,
    countries: new Set(registry.map((source) => source.countryCode)).size,
    regions: new Set(registry.map((source) => source.region)).size,
  };
}


const SOURCE_ADAPTERS = {
  extra: "extra-unbxd", jarir: "jarir-direct", "sharafdg-sa": "sharafdg-algolia", "swarovski-sa": "swarovski-direct",
  "carrefour-sa": "carrefour-ksa", "noon-sa": "noon-catalog", ebay: "ebay",
  "amazon-sa": "amazon-creators:amazon-sa", "amazon-ae": "amazon-creators:amazon-ae",
  "amazon-us": "amazon-creators:amazon-us", "amazon-ca": "amazon-creators:amazon-ca",
  "amazon-uk": "amazon-creators:amazon-uk", "amazon-de": "amazon-creators:amazon-de",
  "amazon-fr": "amazon-creators:amazon-fr", "amazon-it": "amazon-creators:amazon-it",
  "amazon-es": "amazon-creators:amazon-es", "amazon-jp": "amazon-creators:amazon-jp",
  "amazon-in": "amazon-creators:amazon-in", "amazon-sg": "amazon-creators:amazon-sg",
  "amazon-au": "amazon-creators:amazon-au", "amazon-eg": "amazon-creators:amazon-eg",
  "shein-sa": "free-storefronts:shein-sa", "aliexpress-cn": "free-storefronts:aliexpress-cn",
  "temu-global": "free-storefronts:temu-global", "iherb-sa": "free-storefronts:iherb-sa",
  "ikea-sa": "free-storefronts:ikea-sa", "asos-global": "free-storefronts:asos-global",
  "farfetch-sa": "free-storefronts:farfetch-sa", "etsy-global": "free-storefronts:etsy-global",
  "newegg-us": "free-storefronts:newegg-global", "bhphoto": "free-storefronts:bhphoto-us",
  "walmart-us": "free-storefronts:walmart-us", "bestbuy-us": "free-storefronts:bestbuy-us",
  "adidas-sa": "free-storefronts:adidas-sa", "nike-sa": "free-storefronts:nike-sa",
  "sephora-sa": "free-storefronts:sephora-sa",
  "namshi-sa": "free-storefronts:namshi-sa", "centrepoint-sa": "free-storefronts:centrepoint-sa",
  "maxfashion-sa": "free-storefronts:maxfashion-sa",
  "niceone-sa": "free-storefronts:niceone-sa",
};

// Configured means enabled in the running service, not guaranteed live results.
export function buildSourceRegistry({configuredProviders = [], shopifyStores = [], storefronts = []} = {}) {
  const configured = new Set(configuredProviders);
  const sources = WORLD_SOURCE_REGISTRY.map(source => {
    const adapter = SOURCE_ADAPTERS[source.id] || null;
    const storefrontId = {"newegg-us":"newegg-global",bhphoto:"bhphoto-us"}[source.id] || source.id;
    const direct = storefronts.some(store=>store.id===storefrontId) ? "free-storefronts:"+storefrontId : null;
    const adapters = [...new Set([adapter,direct].filter(Boolean))];
    const active = adapters.filter(id=>configured.has(id));
    return {...source, adapter:active[0] || adapter || direct, adapters, status:active.length ? "configured" : adapters.length ? "disabled" : "candidate"};
  });
  const seen = new Set(sources.map(source => source.id));
  for(const store of storefronts) {
    if(isExcludedMerchantSource(store)) continue;
    const adapter="free-storefronts:"+store.id;
    if(sources.some(source=>source.adapters?.includes(adapter)) || seen.has(store.id)) continue;
    seen.add(store.id);
    sources.push({id:store.id,name:store.name,countryCode:store.countryCode,region:"merchant_network",adapter,adapters:[adapter],status:configured.has(adapter)?"configured":"disabled",saudiDelivery:"offer_dependent"});
  }
  for(const store of shopifyStores) {
    if(isExcludedMerchantSource(store)) continue;
    const id = `shopify:${store.id || store.name}`;
    if(seen.has(id) || !/^[A-Z]{2}$/.test(String(store.countryCode).toUpperCase())) continue;
    seen.add(id);
    sources.push({id,name:store.name,countryCode:String(store.countryCode).toUpperCase(),region:"merchant_network",adapter:"shopify",status:configured.has("shopify") ? "configured" : "disabled",saudiDelivery:store.saudiDelivery || "unknown"});
  }
  return sources;
}
