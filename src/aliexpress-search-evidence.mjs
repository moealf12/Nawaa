// AliExpress's live public SSR page embeds structured productV3 objects.
// This adapter deliberately does not fetch/verify PDPs or promote PLP prices.
// It never guesses source URLs from productId or uses originalPrice as a sale.
const ITEM_ID = /^\d{10,20}$/;
const MERCHANT_HOST = /^(?:(?:www|m|ar)\.)?aliexpress\.(?:com|us)$/i;
const CDN_HOST = /^(?:[a-z0-9-]+\.)+(?:alicdn\.com|aliexpress-media\.com)$/i;
const PRODUCT_MARKER = /\{\s*"redirectedId"\s*:/g;
const MAX_HTML_CHARS = 5_000_000;
const MAX_PRODUCTS = 180;
const MAX_BLOCK_CHARS = 180_000;

function readObject(html, start, cap = MAX_BLOCK_CHARS) {
  let depth = 0, inString = false, escaped = false;
  const end = Math.min(html.length, start + cap);
  for (let i = start; i < end; i++) {
    const char = html[i];
    if (escaped) { escaped = false; continue; }
    if (inString && char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function hydrateItemList(html) {
  // Prefer AliExpress's real nested catalog array: object key ordering is not
  // an API contract, and a regex anchored on redirectedId silently drops items.
  // The wrapper is JS, but only its data:{...} JSON object is parsed as JSON.
  const assignments = /_dida_config_\._init_data_\s*=/g;
  let found=0;
  for (const match of html.matchAll(assignments)) {
    if (++found > 3) break;
    const offset=match.index+match[0].length;
    const prefix=html.slice(offset,offset+350);
    const field=/(?:["']?data["']?\s*:\s*)\{/.exec(prefix);
    if (!field) continue;
    const start=offset+field.index+field[0].length-1;
    const parsed=readObject(html,start,2_500_000);
    const state=parsed?.root ? parsed : parsed?.data;
    const items=state?.root?.fields?.mods?.itemList?.content;
    if(Array.isArray(items)) return items.slice(0,MAX_PRODUCTS);
  }
  return null;
}

function decodeTitle(raw) {
  if (typeof raw !== "string" || raw.length > 1200) return null;
  const plain = raw.replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|quot|lt|gt|apos|#39);/gi, v =>
      ({ "&amp;": "&", "&quot;": '"', "&lt;": "<",
        "&gt;": ">", "&apos;": "'", "&#39;": "'" })[v.toLowerCase()] || v)
    .replace(/\s+/g, " ").trim();
  return plain.length >= 3 && plain.length <= 250 ? plain : null;
}

function parsePrice(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(raw))) return null;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 && price < 10_000_000 ? price : null;
}

function merchantItemUrl(raw, productId) {
  if (typeof raw !== "string" || raw.length > 2400 || !ITEM_ID.test(productId)) return null;
  if (!/^(?:https:\/\/|\/\/|\/item\/)/i.test(raw)) return null;
  try {
    const url = new URL(raw, "https://www.aliexpress.com");
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || !MERCHANT_HOST.test(url.hostname)) return null;
    const sourceId = /^\/item\/(\d{10,20})\.html\/?$/i.exec(url.pathname)?.[1];
    if (sourceId !== productId) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function sourceLinkFailureReason(raw, productId) {
  if (typeof raw !== "string" || !/^(?:https:\/\/|\/\/|\/item\/)/i.test(raw))
    return "unsupported_link_scheme_or_relative_path";
  try {
    const link=new URL(raw,"https://www.aliexpress.com");
    if (link.protocol !== "https:" || link.username || link.password ||
        (link.port && link.port !== "443") || !MERCHANT_HOST.test(link.hostname))
      return "unsafe_or_nonmerchant_host";
    const id=/^\/item\/(\d{10,20})\.html\/?$/i.exec(link.pathname)?.[1];
    if (!id) return "non_item_pdp_path";
    if (id !== productId) return "product_id_mismatch";
    return "link_not_attested";
  } catch {return "malformed_url";}
}

function merchantImage(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const url = new URL(raw.startsWith("//") ? "https:" + raw : raw);
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || !CDN_HOST.test(url.hostname) ||
        !url.pathname || url.pathname === "/") return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function itemAnchorsByExactId(html) {
  // A source DOM anchor is an independent publisher-origin link; if
  // productDetailUrl points at a campaign/BundleDeals page, never fabricate a
  // PDP from the numeric ID. Keep only an ACTUAL <a href> from that HTML with
  // the same item ID and a strictly verified AliExpress HTTPS hostname.
  const found=new Map();
  const re=/<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1/gi;
  let scanned=0;
  for(const match of html.matchAll(re)){
    if(++scanned>550)break;
    const raw=match[2].replace(/&amp;/gi,"&").replace(/&#38;/g,"&");
    const id=/\/item\/(\d{10,20})\.html/i.exec(raw)?.[1];
    if(!id || found.has(id))continue;
    const url=merchantItemUrl(raw,id);
    if(url)found.set(id,url);
  }
  return found;
}

// normalizeQuery is injected from the central NAWAA query engine so Arabic,
// English and mixed search retain the same existing token normalization.
export function extractAliExpressSearchEvidence(html, query, diagnostics = null, normalizeQuery = value => String(value).toLowerCase().trim()) {
  const src = String(html || "");
  const samples = [];
  const counts = Object.create(null);
  const reject = (reason, productId, detail = reason) => {
    counts[reason] = (counts[reason] || 0) + 1;
    if (reason === "SOURCE_PDP_LINK_IDENTITY_UNVERIFIED" && samples.length < 5)
      samples.push({productId, reason:detail});
  };
  const report = diagnostics && typeof diagnostics === "object" ? diagnostics : null;
  let parserMode = "STRUCTURED_PRODUCTV3";
  const finalize = accepted => {
    if (report) {
      report.parser = parserMode;
      report.structuredCandidates = scanned;
      report.accepted = accepted.length;
      report.rejectedReasons = {...counts};
      report.rejectedProductLinks = counts.SOURCE_PDP_LINK_IDENTITY_UNVERIFIED || 0;
      report.rejectionSamples = samples;
      report.customerPublishable = false;
    }
    return accepted;
  };
  let scanned = 0;
  if (src.length > MAX_HTML_CHARS) {
    counts.HTML_SIZE_EXCEEDED = 1;
    return finalize([]);
  }
  const tokens = String(normalizeQuery(query) || "").split(/\s+/).filter(token => token.length >= 2);
  const offers = [];
  const seen = new Set();
  const anchorLinks = itemAnchorsByExactId(src);
  // Prefer the explicit itemList.content from one valid hydration object.
  // Fall back to individually balanced productV3 objects for older pages.
  // Both paths remain bounded and share exactly one admission contract.
  const hydrated=hydrateItemList(src);
  const items=[];
  if (hydrated) {
    parserMode="ALIEXPRESS_EMBEDDED_INIT_DATA";
    items.push(...hydrated);
  } else {
    for (const match of src.matchAll(PRODUCT_MARKER)) {
      if (items.length >= MAX_PRODUCTS) break;
      items.push(readObject(src,match.index));
    }
  }
  for (const item of items) {
    scanned++;
    if (!item || typeof item !== "object" || item.itemType !== "productV3") {
      reject("UNPARSEABLE_PRODUCT_OBJECT"); continue;
    }
    const productId = String(item.productId || item.redirectedId || "");
    if (item.productId != null && item.redirectedId != null &&
        String(item.productId) !== String(item.redirectedId)) {
      reject("EMBEDDED_PRODUCT_ID_CONFLICT"); continue;
    }
    const title = decodeTitle(item.title?.displayTitle || item.title?.seoTitle);
    if (!ITEM_ID.test(productId) || !title) { reject("INVALID_ID_OR_TITLE"); continue; }
    if (seen.has(productId)) { reject("DUPLICATE_PRODUCT"); continue; }
    const normalized = String(normalizeQuery(title) || "");
    let queryRelevanceEvidence = "TITLE_TOKEN_OVERLAP";
    if (tokens.length && !tokens.some(token => normalized.includes(token))) {
      // Merchant may return English titles for an Arabic query. Retain these
      // as SOURCE DISCOVERY ONLY, never assert semantic relevance or
      // customer publication. The main AliExpress price hold remains active.
      const crossScript = /[^\x00-\x7f]/.test(String(query || "")) &&
        /[a-z]{3,}/i.test(title);
      if (!crossScript) { reject("QUERY_NOT_RELEVANT"); continue; }
      queryRelevanceEvidence = "MERCHANT_SEARCH_CROSS_SCRIPT_UNVERIFIED";
    }
    const sale = item.prices?.salePrice || item.salePrice;
    if (!sale || typeof sale !== "object") { reject("SALE_PRICE_MISSING"); continue; }
    const price = parsePrice(sale.minPrice);
    const currency = typeof sale.currencyCode === "string" ? sale.currencyCode : null;
    if (price === null || !/^[A-Z]{3}$/.test(currency || "")) {
      reject("SALE_PRICE_OR_CURRENCY_INVALID"); continue;
    }
    const maxPrice = sale.maxPrice == null ? null : parsePrice(sale.maxPrice);
    if (sale.maxPrice != null && (maxPrice === null || maxPrice < price)) {
      reject("VARIANT_PRICE_RANGE_INVALID"); continue;
    }
    const image = merchantImage(item.image?.imgUrl);
    if (!image) { reject("SOURCE_IMAGE_UNVERIFIED"); continue; }
    const sourceUrl = merchantItemUrl(item.productDetailUrl || item.productUrl, productId)
      || anchorLinks.get(productId) || null;
    if (!sourceUrl) {
      reject("SOURCE_PDP_LINK_IDENTITY_UNVERIFIED", productId,
        sourceLinkFailureReason(item.productDetailUrl || item.productUrl, productId));
      continue;
    }
    seen.add(productId);
    offers.push({
      productId, title, image, price, currency, sourceUrl,
      maxVariantPrice:maxPrice,
      priceKind:"SEARCH_CARD_MINIMUM_VARIANT_UNVERIFIED",
      customerPublishable:false,
      pdpPriceVerified:false,
    });
  }
  return finalize(offers);
}
