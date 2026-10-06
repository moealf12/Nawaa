const PLATFORM_HINTS = [
  ["shopify", /cdn\.shopify\.com|Shopify\.theme|shopify-section/i],
  ["salesforce-commerce-cloud", /dwcont|demandware|salesforce commerce/i],
  ["magento", /Magento_|mage\/|checkout\/cart/i],
  ["nextjs", /__NEXT_DATA__|_next\//i],
  ["nuxt", /__NUXT__|_nuxt\//i],
];

export function detectPlatform(html = "", headers = {}) {
  const haystack = String(html);
  const headerText = Object.entries(headers || {}).map(([k,v]) => `${k}:${v}`).join("\n");
  for (const [id, pattern] of PLATFORM_HINTS) {
    if (pattern.test(haystack) || pattern.test(headerText)) return id;
  }
  return "unknown";
}

export function detectCapabilities({ html = "", url = "", headers = {} } = {}) {
  const text = String(html);
  const lower = text.toLowerCase();
  return {
    platform: detectPlatform(text, headers),
    html: text.length > 0,
    jsonLd: /<script[^>]+type=["']application\/ld\+json["']/i.test(text),
    embeddedJson: /__NEXT_DATA__|__NUXT__|application\/json|window\.__/i.test(text),
    sitemapHint: /sitemap/i.test(lower) || /\/sitemap(?:\.xml)?$/i.test(url),
    searchHint: /search|query|q=|searchbox|type=["']search["']/i.test(text) || /[?&](?:q|query|search|text)=/i.test(String(url)),
    productHint: /product|sku|gtin|mpn|price/i.test(lower),
  };
}
