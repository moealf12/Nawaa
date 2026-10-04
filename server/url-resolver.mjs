import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import { moneyToSAR } from "./fx.mjs";
import { normalizeCondition, parseMoney } from "./provider-utils.mjs";
import { extractDomainProduct } from "./domain-adapters.mjs";
import { reconcileProductCandidates } from "./product-reconciliation.mjs";
import { conflictSummary, detectCandidateConflicts } from "./conflict-resolution.mjs";
import { annotateCandidateFreshness, freshnessSummary } from "./freshness.mjs";
import { selectVariantCandidates } from "./product-variant.mjs";
import { extractShopifyVariantState } from "./shopify-page-variant.mjs";

const MAX_HTML_BYTES = 8000000;
const MAX_REDIRECTS = 4;

function isPrivateIpv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  const a = p[0], b = p[1];
  return a >= 224 || a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(ip) {
  // URL canonicalization also normalizes IPv4-mapped dotted addresses to hex.
  const value = new URL(`https://[${ip}]/`).hostname.slice(1,-1).toLowerCase();
  if (value.startsWith("::ffff:")) {
    const parts=value.slice(7).split(":");
    if(parts.length!==2)return true;
    const high=parseInt(parts[0],16),low=parseInt(parts[1],16);
    return isPrivateIpv4([high>>8,high&255,low>>8,low&255].join("."));
  }
  // Only global unicast 2000::/3 is eligible; exclude documentation space.
  return !/^[23][0-9a-f]{3}:/.test(value) || value.startsWith("2001:db8:");
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

export async function resolvePublicHttpsTarget(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS product URLs are allowed");
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error("Invalid product URL");
  if (parsed.port && parsed.port !== "443") throw new Error("Non-standard ports are not allowed");

  const lookupHost = parsed.hostname.replace(/^\\[|\\]$/g, "");
  const records = await dns.lookup(lookupHost, { all: true, verbatim: true });
  if (!records.length) throw new Error("Host could not be resolved");
  if (records.some((record) => isPrivateIp(record.address))) throw new Error("Private/internal addresses are not allowed");
  const pinned = records.find((record) => record.family === 4) || records[0];
  return { parsed, address:pinned.address, family:pinned.family };
}

const PRODUCT_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9,ar-SA;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

async function fetchHtmlWithMockableFetch(target, redirects) {
  const response = await fetch(target.parsed, {
    redirect: "manual",
    headers: PRODUCT_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if ([301,302,303,307,308].includes(response.status)) {
    await response.body?.cancel();
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect without location");
    return fetchHtmlSafe(new URL(location, target.parsed).href, redirects + 1);
  }
  if (!response.ok) throw new Error("Product page returned " + response.status);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("URL is not an HTML product page");
  const reader = response.body && response.body.getReader();
  if (!reader) throw new Error("Product page body unavailable");
  let total=0; const chunks=[];
  while(true){
    const part=await reader.read();
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>MAX_HTML_BYTES){await reader.cancel();throw new Error("Product page is too large");}
    chunks.push(part.value);
  }
  const merged=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}
  return {finalUrl:target.parsed.href,html:new TextDecoder().decode(merged)};
}

function fetchHtmlPinned(target, redirects) {
  return new Promise((resolve, reject) => {
    const hostname = target.parsed.hostname.replace(/^\\[|\\]$/g, "");
    const request = https.request({
      protocol:"https:",
      hostname,
      port:443,
      path:target.parsed.pathname + target.parsed.search,
      method:"GET",
      servername:net.isIP(hostname) ? undefined : hostname,
      headers:{...PRODUCT_HEADERS,host:target.parsed.host},
      agent:false,
      lookup:(_host,_options,callback)=>callback(null,target.address,target.family),
    }, (response) => {
      const status = response.statusCode || 0;
      if ([301,302,303,307,308].includes(status)) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects"));
        const location = response.headers.location;
        if (!location) return reject(new Error("Redirect without location"));
        fetchHtmlSafe(new URL(location, target.parsed).href, redirects + 1).then(resolve,reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error("Product page returned " + status));
      }
      const type = String(response.headers["content-type"] || "");
      if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
        response.resume();
        return reject(new Error("URL is not an HTML product page"));
      }
      let total=0; const chunks=[];
      response.on("data",(chunk)=>{
        total+=chunk.length;
        if(total>MAX_HTML_BYTES){response.destroy(new Error("Product page is too large"));return;}
        chunks.push(chunk);
      });
      response.on("error",reject);
      response.on("end",()=>resolve({finalUrl:target.parsed.href,html:Buffer.concat(chunks,total).toString("utf8")}));
    });
    request.setTimeout(12000,()=>request.destroy(new Error("Product page request timed out")));
    request.on("error",reject);
    request.end();
  });
}

export async function fetchHtmlSafe(url, redirects = 0) {
  const target = await resolvePublicHttpsTarget(url);
  if (process.env.NAWAA_TEST_TRANSPORT === "fetch" || process.env.NODE_TEST_CONTEXT) {
    return fetchHtmlWithMockableFetch(target, redirects);
  }
  return fetchHtmlPinned(target, redirects);
}

function decodeHtml(value = "") {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

function metaContent(html, key, attr = "property") {
  const a = escapeRegex(attr);
  const k = escapeRegex(key);
  const patterns = [
    new RegExp("<meta[^>]+" + a + "=[\"']" + k + "[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>", "i"),
    new RegExp("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+" + a + "=[\"']" + k + "[\"'][^>]*>", "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtml(m[1]).trim();
  }
  return null;
}

function titleFromHtml(html) {
  const og = metaContent(html, "og:title");
  if (og) return og;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtml(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : null;
}

function imageFromHtml(html) {
  return metaContent(html, "og:image") || metaContent(html, "twitter:image", "name");
}

function flattenJsonLd(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => flattenJsonLd(item, out));
    return out;
  }
  if (typeof node !== "object") return out;
  out.push(node);
  if (node["@graph"]) flattenJsonLd(node["@graph"], out);
  return out;
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[1].trim();
    if (!raw || raw.length > 750000) continue;
    try {
      flattenJsonLd(JSON.parse(raw), out);
    } catch {}
  }
  return out;
}

function typeIncludesProduct(type) {
  if (Array.isArray(type)) return type.some(typeIncludesProduct);
  return String(type || "").toLowerCase() === "product";
}


function walkJson(node, visit, depth = 0, seen = new Set()) {
  if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return;
  seen.add(node);
  visit(node);
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 500)) walkJson(item, visit, depth + 1, seen);
    return;
  }
  for (const value of Object.values(node)) walkJson(value, visit, depth + 1, seen);
}

function firstValue(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function embeddedOfferCandidate(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const title = firstValue(node, ["name","title","productName","product_name"]);
  const priceRaw = firstValue(node, ["salePrice","sale_price","sellingPrice","finalPrice","price","currentPrice","current_price"]);
  const priceObj = priceRaw && typeof priceRaw === "object" ? priceRaw : null;
  const price = parseMoney(priceObj ? firstValue(priceObj, ["value","amount","price"]) : priceRaw);
  const currency = firstValue(node, ["currency","priceCurrency","currencyCode","currency_code"]) ||
    (priceObj && firstValue(priceObj, ["currency","currencyCode","currency_code"]));
  const imageRaw = firstValue(node, ["image","imageUrl","image_url","thumbnail","thumbnailUrl"]);
  const image = typeof imageRaw === "string" ? imageRaw :
    (Array.isArray(imageRaw) ? imageRaw[0] : imageRaw && firstValue(imageRaw, ["url","src"]));
  const brandRaw = firstValue(node, ["brand","brandName","brand_name"]);
  const brand = typeof brandRaw === "string" ? brandRaw : brandRaw && firstValue(brandRaw, ["name","title"]);
  const sku = firstValue(node, ["sku","productId","product_id","id"]);
  const mpn = firstValue(node, ["mpn","modelNumber"]);
  const availabilityRaw = String(firstValue(node, ["availability","stockStatus","stock_status","inventoryStatus"]) || "").toLowerCase();

  if (typeof title !== "string" || title.trim().length < 3 || price === null || !currency) return null;
  return {
    name:title.trim(),
    image:image || null,
    brand:brand || null,
    sku:sku ? String(sku) : null,
    mpn:mpn ? String(mpn) : null,
    offers:{
      price,
      priceCurrency:String(currency).toUpperCase(),
      availability:availabilityRaw,
    },
  };
}

export function extractEmbeddedProductState(html) {
  const candidates = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    const attrs = match[1] || "";
    const raw = match[2].trim();
    if (!raw || raw.length > 1500000) continue;
    const looksJson = /type=["']application\/json["']/i.test(attrs) ||
      /id=["']__NEXT_DATA__["']/i.test(attrs) ||
      /^[\[{]/.test(raw);
    if (!looksJson) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    walkJson(parsed, (node) => {
      const candidate = embeddedOfferCandidate(node);
      if (candidate) candidates.push(candidate);
    });
  }
  candidates.sort((a,b) =>
    Number(Boolean(b.image)) - Number(Boolean(a.image)) ||
    Number(Boolean(b.brand)) - Number(Boolean(a.brand))
  );
  return candidates[0] || null;
}


function scoreCandidate(candidate) {
  if (!candidate) return 0;
  let score = 1;
  if (candidate.image) score += 2;
  if (candidate.brand) score += 1;
  if (candidate.sku) score += 1;
  const offer = chooseOffer(candidate);
  if (offer?.price !== null) score += 2;
  if (offer?.currency) score += 1;
  if (offer?.availability) score += 0.5;
  return score;
}

function extractBalancedJsonAfter(html, marker) {
  const source = String(html || "");
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < source.length && i - start <= 1500000; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(source.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function extractStorefrontProductState(html) {
  const source = String(html || "");
  const candidates = [];

  // Shopify and similar storefronts commonly expose product JSON in script blocks
  // or hydration payloads. Reuse the bounded JSON walker rather than executing JS.
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(source))) {
    const attrs = match[1] || "";
    const raw = match[2].trim();
    if (!raw || raw.length > 1500000) continue;
    const storefrontHint =
      /product|shopify|storefront|commerce|application\/json/i.test(attrs) ||
      /"variants"\s*:|"product"\s*:|"selectedOrFirstAvailableVariant"/i.test(raw);
    if (!storefrontHint || !/^[\[{]/.test(raw)) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    walkJson(parsed, (node) => {
      const candidate = embeddedOfferCandidate(node);
      if (candidate) candidates.push(candidate);
    });
  }

  candidates.sort((a,b) =>
    Number(Boolean(b.image)) - Number(Boolean(a.image)) ||
    Number(Boolean(b.brand)) - Number(Boolean(a.brand))
  );
  return candidates[0] || null;
}

export function extractHydratedProductState(html) {
  const candidates = [];
  for (const marker of ["window.__INITIAL_STATE__", "__INITIAL_STATE__", "window.__PRELOADED_STATE__", "__PRELOADED_STATE__", "window.__APOLLO_STATE__", "__APOLLO_STATE__"]) {
    const parsed = extractBalancedJsonAfter(html, marker);
    if (!parsed) continue;
    walkJson(parsed, (node) => {
      const candidate = embeddedOfferCandidate(node);
      if (candidate) candidates.push(candidate);
    });
  }
  candidates.sort((a,b) => scoreCandidate(b) - scoreCandidate(a));
  return candidates[0] || null;
}

export function extractMetaProductState(html) {
  const title = titleFromHtml(html);
  const image = imageFromHtml(html);
  const price = parseMoney(
    metaContent(html, "product:price:amount") ||
    metaContent(html, "og:price:amount") ||
    metaContent(html, "twitter:data1", "name")
  );
  const currency =
    metaContent(html, "product:price:currency") ||
    metaContent(html, "og:price:currency") ||
    null;
  if (!title && !image && price === null) return null;
  return {
    name:title || null,
    image:image || null,
    brand:null,
    sku:null,
    offers:{
      price,
      priceCurrency:currency ? String(currency).toUpperCase() : null,
      availability:"",
    },
  };
}

export function extractionCandidates(html, url = null) {
  const nodes = extractJsonLd(html);
  const products = nodes.filter((node) => typeIncludesProduct(node && node["@type"]));
  const jsonld = products.find((p) => chooseOffer(p)) || products[0] || null;
  const embedded = extractEmbeddedProductState(html);
  const hydrated = extractHydratedProductState(html);
  const storefront = (url && extractShopifyVariantState(html,url)) || extractStorefrontProductState(html);
  const adapted = url ? extractDomainProduct(url, html) : null;
  const meta = extractMetaProductState(html);
  return [
    { strategy:"jsonld", product:jsonld, confidence:jsonld ? 0.99 : 0 },
    { strategy:"embedded_json", product:embedded, confidence:embedded ? 0.94 : 0 },
    { strategy:"hydrated_state", product:hydrated, confidence:hydrated ? 0.9 : 0 },
    { strategy:"storefront_data", product:storefront, confidence:storefront ? 0.92 : 0 },
    { strategy:"domain_adapter", product:adapted?.product || null, confidence:adapted ? 0.96 : 0, adapterId:adapted?.adapterId || null },
    { strategy:"meta", product:meta, confidence:meta ? 0.72 : 0 },
  ].filter((entry) => entry.product);
}

function chooseOffer(product) {
  const raw = product && product.offers;
  let offers = [];
  if (Array.isArray(raw)) offers = raw;
  else if (raw && Array.isArray(raw.offers)) offers = raw.offers;
  else if (raw) offers = [raw];

  const normalized = offers.map((offer) => ({
    raw: offer,
    price: parseMoney(offer && (offer.price ?? offer.lowPrice ?? offer.highPrice)),
    currency: offer && offer.priceCurrency || null,
    availability: String(offer && offer.availability || "").toLowerCase(),
    url: offer && offer.url || null,
  })).filter((offer) => offer.price !== null);

  normalized.sort((x,y) => x.price - y.price);
  return normalized[0] || null;
}

function inferCountry(url, currency) {
  const host = new URL(url).hostname.toLowerCase();
  const map = [
    [".sa","SA","السعودية"],[".ae","AE","الإمارات"],[".uk","GB","بريطانيا"],
    [".de","DE","ألمانيا"],[".fr","FR","فرنسا"],[".it","IT","إيطاليا"],
    [".es","ES","إسبانيا"],[".jp","JP","اليابان"],[".kr","KR","كوريا الجنوبية"],
    [".cn","CN","الصين"],[".in","IN","الهند"],[".sg","SG","سنغافورة"],
    [".au","AU","أستراليا"],[".ca","CA","كندا"],[".mx","MX","المكسيك"],
    [".br","BR","البرازيل"],[".eg","EG","مصر"],[".za","ZA","جنوب أفريقيا"],
    [".nl","NL","هولندا"],[".pl","PL","بولندا"],[".ch","CH","سويسرا"],
    [".at","AT","النمسا"],[".ie","IE","أيرلندا"],[".be","BE","بلجيكا"]
  ];
  for (const item of map) {
    if (host.endsWith(item[0])) return { countryCode: item[1], countryNameAr: item[2] };
  }

  const byCurrency = {
    SAR:["SA","السعودية"],AED:["AE","الإمارات"],USD:["US","الولايات المتحدة"],
    GBP:["GB","بريطانيا"],EUR:["EU","أوروبا"],JPY:["JP","اليابان"],
    KRW:["KR","كوريا الجنوبية"],CNY:["CN","الصين"],INR:["IN","الهند"],
    SGD:["SG","سنغافورة"],AUD:["AU","أستراليا"],CAD:["CA","كندا"]
  }[String(currency || "").toUpperCase()];

  return byCurrency
    ? { countryCode: byCurrency[0], countryNameAr: byCurrency[1] }
    : { countryCode: "UN", countryNameAr: "دولي" };
}

function merchantName(url) {
  const host = new URL(url).hostname.replace(/^www\./i, "");
  const first = host.split(".")[0] || host;
  return first.charAt(0).toUpperCase() + first.slice(1);
}


export async function extractProductDocument(url) {
  const fetched = await fetchHtmlSafe(url);
  const candidates = extractionCandidates(fetched.html, fetched.finalUrl);
  return {
    finalUrl:fetched.finalUrl,
    candidates,
    diagnostics:{
      attemptedStrategies:["jsonld","embedded_json","hydrated_state","storefront_data","domain_adapter","meta"],
      availableStrategies:candidates.map((entry) => entry.strategy),
      domainAdapters:candidates
        .filter((entry) => entry.strategy === "domain_adapter" && entry.adapterId)
        .map((entry) => entry.adapterId),
      htmlBytes:new TextEncoder().encode(fetched.html).byteLength,
    },
  };
}

export async function resolveProductUrl(url) {
  const extracted = await extractProductDocument(url);
  const finalUrl = extracted.finalUrl;
  const requested = new URL(url);
  const resolved = new URL(finalUrl);
  if (requested.searchParams.has('variant') && (
    requested.searchParams.get('variant') !== resolved.searchParams.get('variant') ||
    requested.hostname.replace(/^www\./,'') !== resolved.hostname.replace(/^www\./,'') ||
    requested.pathname.replace(/\/+$/,'') !== resolved.pathname.replace(/\/+$/,'')
  )) throw new Error('Requested product variant could not be verified');
  const observedAt = new Date().toISOString();
  const candidates = annotateCandidateFreshness(selectVariantCandidates(extracted.candidates, finalUrl), observedAt);
  const html = null;
  const selected = candidates.find((entry) => {
    const offer = chooseOffer(entry.product);
    return offer && offer.price !== null && offer.currency;
  }) || candidates[0] || null;
  const freshnessState = freshnessSummary(candidates);
  const reconciliation = reconcileProductCandidates(candidates, selected);
  const compatibleCandidates = reconciliation.identity?.accepted?.length
    ? reconciliation.identity.accepted
    : candidates;
  const conflicts = detectCandidateConflicts(compatibleCandidates);
  const conflictState = conflictSummary(conflicts);
  const product = reconciliation.product || selected?.product || null;
  const offer = chooseOffer(product);
  const selectionReason = selected
    ? (selected.strategy === "domain_adapter"
      ? "domain_adapter_with_complete_price"
      : "highest_priority_candidate_with_complete_price")
    : "no_product_candidate";

  const baseTitle = product && product.name || null;
  const label = product?.variantId && typeof offer?.raw?.name === 'string' && offer.raw.name !== 'Default Title' ? offer.raw.name.trim() : '';
  // The reconciled price Offer has already passed explicit variant and identity
  // checks. Preserve its label when a higher-priority name describes the family.
  const title = baseTitle && label && !baseTitle.endsWith(` · ${label}`) ? `${baseTitle} · ${label}` : baseTitle;
  const imageRaw = product && product.image;
  const image = Array.isArray(imageRaw)
    ? (typeof imageRaw[0] === "string" ? imageRaw[0] : imageRaw[0] && imageRaw[0].url)
    : (typeof imageRaw === "string" ? imageRaw : imageRaw && imageRaw.url) || null;

  const originalPrice = (offer && offer.price) ?? null;
  const originalCurrency = (offer && offer.currency) || null;

  const priceSAR = originalPrice !== null && originalCurrency
    ? await moneyToSAR(originalPrice, originalCurrency).catch(() => null)
    : null;

  const country = inferCountry(finalUrl, originalCurrency);
  const rawCondition = product && product.itemCondition || "new";
  const condition = normalizeCondition(rawCondition);

  return {
    provider: "url-resolver",
    providerMarket: new URL(finalUrl).hostname,
    merchant: merchantName(finalUrl),
    merchantCountryCode: country.countryCode,
    merchantCountryNameAr: country.countryNameAr,
    sourceUrl: offer && offer.url ? new URL(offer.url, finalUrl).href : finalUrl,
    resolvedPageUrl:finalUrl,
    image: image ? new URL(image, finalUrl).href : null,
    title: title || "منتج من رابط خارجي",
    sku: product?.sku || null,
    variantId: product?.variantId || null,
    vendor:product?.vendor || null,
    productType:product?.productType || null,
    specs: {
      brand: typeof product?.brand === "string" ? product.brand : product?.brand?.name || null,
      deviceType: typeof product?.model === "string" ? product.model : product?.model?.name || null,
      color: product?.color || null,
      modelNumber: product?.mpn || null,
      barcode: product?.gtin13 || product?.gtin14 || product?.gtin || null,
    },
    condition: condition === "unknown" ? "new" : condition,
    availability: offer && offer.availability.includes("instock") ? "in_stock" : "unknown",
    canShipToSaudi: country.countryCode === "SA" ? true : null,
    productPrice: (priceSAR && priceSAR.value) ?? null,
    originalProductPrice: originalPrice,
    shipping: null,
    importCost: null,
    tax: null,
    mandatoryFees: 0,
    discount: 0,
    currency: "SAR",
    originalCurrency: originalCurrency,
    exactMatch: true,
    matchConfidence: title ? 0.98 : 0.7,
    priceConfidence: priceSAR ? "incomplete" : "unknown",
    isLocal: country.countryCode === "SA",
    deliveryDays: null,
    observedAt,
    dataKind: "live",
    fx: priceSAR ? { rate: priceSAR.rate, source: priceSAR.source, observedAt: priceSAR.observedAt } : null,
    extraction: {
      strategy: selected?.strategy || "none",
      confidence: selected?.confidence || 0,
      selectionReason,
      attemptedStrategies: ["jsonld","embedded_json","hydrated_state","storefront_data","domain_adapter","meta"],
      availableStrategies: candidates.map((entry) => entry.strategy),
      availableDomainAdapters: extracted.diagnostics.domainAdapters || [],
      reconciled: reconciliation.reconciled,
      contributingStrategies: reconciliation.contributingStrategies,
      fieldSources: reconciliation.fieldSources,
      conflicts,
      conflictSummary: conflictState,
      freshness: freshnessState,
      identity: {
        summary: reconciliation.identity?.summary || { accepted:0, rejected:0, rejectedSources:[], anchorSource:null },
        comparisons: (reconciliation.identity?.comparisons || []).map((item) => ({
          source:item.source,
          score:item.score,
          verdict:item.verdict,
          matches:item.matches,
          conflicts:item.conflicts,
          titleSimilarity:item.titleSimilarity ?? null,
        })),
      },
      jsonLdProductFound: candidates.some((entry) => entry.strategy === "jsonld"),

      embeddedJsonProductFound: candidates.some((entry) => entry.strategy === "embedded_json"),
      nextDataProductFound: extracted.diagnostics.availableStrategies.includes("embedded_json"),
      hydrationProductFound: candidates.some((entry) => entry.strategy === "hydrated_state"),
      storefrontProductFound: candidates.some((entry) => entry.strategy === "storefront_data"),
      domainAdapterFound: candidates.some((entry) => entry.strategy === "domain_adapter"),
      domainAdapterId: candidates.find((entry) => entry.strategy === "domain_adapter")?.adapterId || null,
      shopifyProductFound: candidates.some(entry=>entry.product?.shopifyVariantEvidence === true) || (selected?.strategy === "storefront_data" && /shopify/i.test(JSON.stringify(extracted.diagnostics))),
      structuredPriceFound: originalPrice !== null,
      structuredCurrencyFound: Boolean(originalCurrency)
    }
  };
}
