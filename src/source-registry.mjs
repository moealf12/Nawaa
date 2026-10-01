// NAWAA global source registry.
// "candidate" means the merchant/market is a discovery target, not yet an active adapter.
// Saudi delivery must be verified per offer before an item can be ranked.

export const WORLD_SOURCE_REGISTRY = [
  // Saudi Arabia / GCC
  { id: "amazon-sa", name: "Amazon.sa", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "noon-sa", name: "Noon Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "jarir", name: "Jarir", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "extra", name: "eXtra", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "amazon-ae", name: "Amazon.ae", countryCode: "AE", region: "MENA", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "noon-ae", name: "Noon UAE", countryCode: "AE", region: "MENA", status: "candidate", saudiDelivery: "offer_dependent" },

  { id: "sharafdg-sa", name: "Sharaf DG Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },
  { id: "carrefour-sa", name: "Carrefour Saudi", countryCode: "SA", region: "MENA", status: "candidate", saudiDelivery: "native" },

  // North America
  { id: "amazon-us", name: "Amazon.com", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "ebay", name: "eBay", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "seller_dependent" },
  { id: "newegg-us", name: "Newegg", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "verified_market" },
  { id: "bhphoto", name: "B&H Photo", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "verified_market" },
  { id: "walmart-us", name: "Walmart", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "unknown" },
  { id: "bestbuy-us", name: "Best Buy", countryCode: "US", region: "North America", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-ca", name: "Amazon.ca", countryCode: "CA", region: "North America", status: "candidate", saudiDelivery: "offer_dependent" },

  // United Kingdom / Europe
  { id: "amazon-uk", name: "Amazon.co.uk", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "currys", name: "Currys", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "argos", name: "Argos", countryCode: "GB", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-de", name: "Amazon.de", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "mediamarkt-de", name: "MediaMarkt", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "kaufland-de", name: "Kaufland", countryCode: "DE", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-fr", name: "Amazon.fr", countryCode: "FR", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "fnac-fr", name: "Fnac", countryCode: "FR", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "cdiscount-fr", name: "Cdiscount", countryCode: "FR", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
  { id: "amazon-it", name: "Amazon.it", countryCode: "IT", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "amazon-es", name: "Amazon.es", countryCode: "ES", region: "Europe", status: "candidate", saudiDelivery: "offer_dependent" },
  { id: "pccomponentes-es", name: "PcComponentes", countryCode: "ES", region: "Europe", status: "candidate", saudiDelivery: "unknown" },
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
  extra: "extra-unbxd", jarir: "jarir-direct", "sharafdg-sa": "sharafdg-algolia",
  "carrefour-sa": "carrefour-ksa", "noon-sa": "noon-catalog", ebay: "ebay",
};

// Configured means enabled in the running service, not guaranteed live results.
export function buildSourceRegistry({configuredProviders = [], shopifyStores = []} = {}) {
  const configured = new Set(configuredProviders);
  const sources = WORLD_SOURCE_REGISTRY.map(source => {
    const adapter = SOURCE_ADAPTERS[source.id] || null;
    return {...source, adapter, status: adapter ? (configured.has(adapter) ? "configured" : "disabled") : "candidate"};
  });
  const seen = new Set(sources.map(source => source.id));
  for(const store of shopifyStores) {
    const id = `shopify:${store.id || store.name}`;
    if(seen.has(id) || !/^[A-Z]{2}$/.test(String(store.countryCode).toUpperCase())) continue;
    seen.add(id);
    sources.push({id,name:store.name,countryCode:String(store.countryCode).toUpperCase(),region:"merchant_network",adapter:"shopify",status:configured.has("shopify") ? "configured" : "disabled",saudiDelivery:store.saudiDelivery || "unknown"});
  }
  return sources;
}
