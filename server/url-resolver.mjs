import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import { moneyToSAR } from "./fx.mjs";
import { normalizeCondition, normalizeAvailability, parseMoney, firstPositivePriceField } from "./provider-utils.mjs";
import { extractDomainProduct } from "./domain-adapters.mjs";
import { reconcileProductCandidates } from "./product-reconciliation.mjs";
import { conflictSummary, detectCandidateConflicts } from "./conflict-resolution.mjs";
import { annotateCandidateFreshness, freshnessSummary } from "./freshness.mjs";
import { selectVariantCandidates } from "./product-variant.mjs";
import { extractShopifyVariantState } from "./shopify-page-variant.mjs";
import { resolveStructuredProductNodes } from "./schemaorg-product-graph.mjs";

const MAX_HTML_BYTES = 8000000;
const MAX_REDIRECTS = 4;
// v21.39: Diagnostic phase markers contain no URLs, IPs, cookies, prices or
// merchant HTML. An observer must never change resolver behavior.
const reportStage = (onStage, stage) => { try { if (typeof onStage === 'function') onStage(stage); } catch {} };

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

export async function resolvePublicHttpsTarget(url, {onStage} = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS product URLs are allowed");
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error("Invalid product URL");
  if (parsed.port && parsed.port !== "443") throw new Error("Non-standard ports are not allowed");

  const lookupHost = parsed.hostname.replace(/^\\[|\\]$/g, "");
  reportStage(onStage, 'dns_lookup_start');
  const records = await dns.lookup(lookupHost, { all: true, verbatim: true });
  reportStage(onStage, 'dns_lookup_done');
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

async function fetchHtmlWithMockableFetch(target, redirects, signal, onStage) {
  reportStage(onStage, 'request_start');
  const response = await fetch(target.parsed, {
    redirect: "manual",
    headers: PRODUCT_HEADERS,
    signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  });
  reportStage(onStage, 'response_headers');
  if ([301,302,303,307,308].includes(response.status)) {
    await response.body?.cancel();
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect without location");
    return fetchHtmlSafe(new URL(location, target.parsed).href, redirects + 1, {signal,onStage});
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
  reportStage(onStage, 'response_body_complete');
  const merged=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}
  return {finalUrl:target.parsed.href,html:new TextDecoder().decode(merged)};
}

function fetchHtmlPinned(target, redirects, signal, onStage) {
  return new Promise((resolve, reject) => {
    if(signal?.aborted)return reject(signal.reason instanceof Error?signal.reason:new Error("Product page request aborted"));
    const hostname = target.parsed.hostname.replace(/^\\[|\\]$/g, "");
    reportStage(onStage, 'request_start');
    const request = https.request({
      protocol:"https:",
      hostname,
      port:443,
      path:target.parsed.pathname + target.parsed.search,
      method:"GET",
      servername:net.isIP(hostname) ? undefined : hostname,
      headers:{...PRODUCT_HEADERS,host:target.parsed.host},
      agent:false,
      lookup:(_host,options,callback)=>{
        if(options?.all) callback(null,[{address:target.address,family:target.family}]);
        else callback(null,target.address,target.family);
      },
    }, (response) => {
      reportStage(onStage, 'response_headers');
      const status = response.statusCode || 0;
      if ([301,302,303,307,308].includes(status)) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects"));
        const location = response.headers.location;
        if (!location) return reject(new Error("Redirect without location"));
        fetchHtmlSafe(new URL(location, target.parsed).href, redirects + 1, {signal,onStage}).then(resolve,reject);
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
      response.on("end",()=>{reportStage(onStage,"response_body_complete");resolve({finalUrl:target.parsed.href,html:Buffer.concat(chunks,total).toString("utf8")});});
    });
    request.once('socket', socket => {
      reportStage(onStage, 'socket_assigned');
      socket.once('connect', () => reportStage(onStage, 'tcp_connected'));
      socket.once('secureConnect', () => reportStage(onStage, 'tls_connected'));
    });
    const abort=()=>request.destroy(signal.reason instanceof Error?signal.reason:new Error("Product page request aborted"));
    signal?.addEventListener("abort",abort,{once:true});
    request.once("close",()=>signal?.removeEventListener("abort",abort));
    request.setTimeout(12000,()=>request.destroy(new Error("Product page request timed out")));
    request.on("error",reject);
    request.end();
  });
}

export async function fetchHtmlSafe(url, redirects = 0, {signal,onStage} = {}) {
  const target = await resolvePublicHttpsTarget(url,{onStage});
  if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new Error("Product page request aborted");
  if (process.env.NAWAA_TEST_TRANSPORT === "fetch" || process.env.NODE_TEST_CONTEXT) {
    return fetchHtmlWithMockableFetch(target, redirects, signal, onStage);
  }
  return fetchHtmlPinned(target, redirects, signal, onStage);
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

function extractJsonLd(html, pageUrl = null, {requireComplete=false} = {}) {
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
  // The certifier must never infer uniqueness from a silently truncated graph.
  if(requireComplete&&out.length>512)throw Error('selected_pdp_schema_budget_exceeded');
  return resolveStructuredProductNodes(out, pageUrl);
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
  const selectedPrice = firstPositivePriceField(node,
    ["salePrice","sale_price","sellingPrice","finalPrice","currentPrice","current_price","price"],
    ["value","amount","price"]);
  const priceObj = selectedPrice?.raw && typeof selectedPrice.raw === "object" ? selectedPrice.raw : null;
  const price = selectedPrice?.amount ?? null;
  // The selected price's explicit currency belongs to that exact sellable
  // amount. A generic catalog/root currency is fallback only, never an
  // override that converts a correctly priced SKU at the wrong FX rate.
  const currency = (priceObj && firstValue(priceObj, ["currency","currencyCode","currency_code","priceCurrency"])) ||
    firstValue(node, ["currency","priceCurrency","currencyCode","currency_code"]);
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
    // Schema.org JSON-LD is handled by the identity-aware JSON-LD path.
    // Treating the same script as arbitrary embedded state independently
    // promotes each nested variant Offer into an unrelated priced Product.
    if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
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
  const nodes = extractJsonLd(html, url);
  const products = nodes.filter((node) => typeIncludesProduct(node && node["@type"]));
  // An explicit family ProductGroup is evidence for this product page.
  // A separate priced Product in the same graph may be a recommendation or
  // cross-sell, not the requested item. Never let its cheaper price displace
  // an ambiguous generic family. Explicit variants are resolved downstream.
  const groups = products.filter(p => p.schemaProductGroupEvidence === true);
  const jsonld = groups.length ? (groups.length === 1 ? groups[0] : null)
    : products.find((p) => chooseOffer(p)) || products[0] || null;
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
  const raw = product?.offers;
  // AggregateOffer advertises a PRICE RANGE, not an item-level merchant
  // price. Do not promote lowPrice or highPrice into a purchasable offer.
  const type = value => Array.isArray(value?.["@type"])
    ? value["@type"].some(t=>String(t).toLowerCase()==="aggregateoffer")
    : String(value?.["@type"]||"").toLowerCase()==="aggregateoffer";
  if (type(raw)) return null;
  const offers = Array.isArray(raw) ? raw
    : raw && Array.isArray(raw.offers) ? raw.offers
    : raw ? [raw] : [];
  // An unqualified Product page with sibling variants cannot establish
  // which variant the requested URL selects. Explicit ?variant=... requests
  // are narrowed to a single exact Offer by selectVariantCandidates().
  if (offers.length !== 1 || type(offers[0])) return null;
  const offer = offers[0];
  const price = parseMoney(offer?.price);
  if (price === null || price <= 0) return null;
  return {
    raw:offer,price,
    currency:offer.priceCurrency || null,
    availability:String(offer.availability||"").toLowerCase(),
    url:offer.url || null,
  };
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

export function merchantName(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  // Infrastructure subdomains are not retailer brands.
  const infrastructure = new Set(["app","shop","store","mobile","m","web"]);
  const first = labels.length >= 3 && infrastructure.has(labels[0]) ? labels[1] : labels[0];
  const known = {virginmegastore:"Virgin Megastore",extra:"eXtra",jarir:"Jarir"};
  return known[first] || (first ? first.charAt(0).toUpperCase() + first.slice(1) : host);
}



function declaredSchemaProductType(product) {
  // Some merchants publish the core-versus-accessory product type only in
  // Schema.org additionalProperty. Preserve explicitly declared PDP evidence
  // without guessing from category labels, descriptions or sibling products.
  const properties = Array.isArray(product?.additionalProperty)
    ? product.additionalProperty.slice(0, 50)
    : product?.additionalProperty ? [product.additionalProperty] : [];
  const types = new Map();
  for (const property of properties) {
    if (!property || typeof property !== "object" || Array.isArray(property)) continue;
    const key = String(property.name ?? property.propertyID ?? "").trim().toLowerCase();
    if (key !== "type" && key !== "product type") continue;
    if (typeof property.value !== "string") continue;
    const value = property.value.trim();
    if (!value || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) continue;
    types.set(value.toLowerCase(), value);
  }
  // Conflicting merchant claims remain unknown, never pick an arbitrary Type.
  return types.size === 1 ? types.values().next().value : null;
}

export async function extractProductDocument(url, options = {}) {
  const fetched = await fetchHtmlSafe(url, 0, options);
  reportStage(options.onStage,'extraction_start');
  const candidates = extractionCandidates(fetched.html, fetched.finalUrl);
  reportStage(options.onStage,'extraction_done');
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

export async function resolveProductUrl(url, options = {}) {
  const extracted = await extractProductDocument(url, options);
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
  reportStage(options.onStage,'reconciliation_start');
  const reconciliation = reconcileProductCandidates(candidates, selected);
  reportStage(options.onStage,'reconciliation_done');
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

  reportStage(options.onStage,'fx_conversion_start');
  const priceSAR = originalPrice !== null && originalCurrency
    ? await moneyToSAR(originalPrice, originalCurrency).catch(() => null)
    : null;
  reportStage(options.onStage,'fx_conversion_done');

  const country = inferCountry(finalUrl, originalCurrency);
  const rawCondition = product && product.itemCondition || "";
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
    productType:product?.productType || declaredSchemaProductType(product),
    specs: {
      brand: typeof product?.brand === "string" ? product.brand : product?.brand?.name || null,
      deviceType: typeof product?.model === "string" ? product.model : product?.model?.name || null,
      color: product?.color || null,
      modelNumber: product?.mpn || null,
      barcode: product?.gtin13 || product?.gtin14 || product?.gtin || null,
    },
    condition,
    availability: normalizeAvailability(offer?.availability || ""),
    canShipToSaudi: country.countryCode === "SA" ? true : null,
    productPrice: (priceSAR && priceSAR.value) ?? null,
    originalProductPrice: originalPrice,
    shipping: null,
    importCost: null,
    tax: null,
    mandatoryFees: 0,
    discount: 0,
    currency: priceSAR ? "SAR" : null,
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


// A selected Product can declare multiple GS1 fields. Never silently pick
// gtin14 while ignoring contradictory gtin13/gtin values in that SAME record.
// Compare left-zero padded values for GS1 equivalence, preserve original text.
function selectedGtin(product){
  const claimed=['gtin14','gtin13','gtin12','gtin8','gtin']
    .filter(key=>product?.[key]!=null&&String(product[key]).trim()!=='')
    .map(key=>String(product[key]).trim());
  if(!claimed.length)return null;
  const valid=value=>{
    if(!/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(value))return false;
    const digits=value.split('').map(Number);
    const sum=digits.slice(0,-1).reverse().reduce((total,digit,i)=>
      total+digit*(i%2===0?3:1),0);
    return (10-sum%10)%10===digits.at(-1);
  };
  if(claimed.some(value=>!valid(value)))throw Error('selected_pdp_invalid_gs1_gtin');
  const expected=claimed[0].padStart(14,'0');
  if(claimed.some(value=>value.padStart(14,'0')!==expected))
    throw Error('selected_pdp_conflicting_gtin_fields');
  return claimed[0];
}

// v21.63: strictly selected Product/Offer observation, without cross-strategy
// reconciliation. Reuses pinned-DNS, redirect validation and bounded fetch.
// Does not certify a merchant: only the controlled server verifier may do so.
export async function resolveSelectedJsonLdOffer(url, options = {}) {
  const fetched=await fetchHtmlSafe(url,0,options);
  const finalUrl=fetched.finalUrl;
  const requested=new URL(url),page=new URL(finalUrl);
  const samePage=(candidate)=>{
    if(typeof candidate!=='string'||!candidate.trim())return false;
    try{
      const u=new URL(candidate,page);
      if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return false;
      if(u.hostname!==page.hostname||u.pathname.replace(/\/+$/,'')!==page.pathname.replace(/\/+$/,''))return false;
      const selectors=new Set(['sku','variant','variantid','productid','optionid','model','storage','capacity','color','size']);
      const collect=v=>{
        const fields=new Map();
        for(const [k,val] of v.searchParams){
          const key=k.toLowerCase().replace(/[^a-z0-9]/g,'');
          if(!selectors.has(key))continue;
          if(!val||fields.has(key))return null;
          fields.set(key,val.toLowerCase());
        }
        return fields;
      };
      const a=collect(requested),b=collect(u);
      if(!a||!b||a.size!==b.size)return false;
      for(const [k,v] of a)if(b.get(k)!==v)return false;
      return true;
    }catch{return false;}
  };
  if(!samePage(finalUrl))throw Error('selected_pdp_redirect_mismatch');
  const nodes=extractJsonLd(fetched.html,finalUrl,{requireComplete:true});
  if(nodes.length>512)throw Error('selected_pdp_schema_budget_exceeded');
  const products=nodes.filter(n=>typeIncludesProduct(n?.['@type']));
  // Explicit node.url is mandatory: @id alone identifies a graph record,
  // not necessarily the purchasable subject of the requested destination.
  const declared=products.filter(n=>typeof n.url==='string'&&samePage(n.url));
  if(declared.length!==1)throw Error('selected_pdp_subject_missing_or_ambiguous');
  const product=declared[0];
  const priced=chooseOffer(product);
  if(!priced||priced.currency!=='SAR'||priced.raw?.['@type']==='AggregateOffer')
    throw Error('selected_pdp_unique_priced_offer_required');
  if(priced.url&&!samePage(priced.url))throw Error('selected_pdp_offer_destination_conflict');
  // A merchant-scoped SKU or GTIN anchors the chosen subject. Shared MPN or
  // plausible title alone cannot make the source page into a sellable SKU.
  const sku=typeof product.sku==='string'||typeof product.sku==='number'
    ?String(product.sku).trim():null;
  const gtin=selectedGtin(product);
  if(!sku&&!gtin)throw Error('selected_pdp_hard_identity_missing');
  const brand=typeof product.brand==='string'?product.brand:product.brand?.name||null;
  const imageRaw=product.image;
  const image=typeof imageRaw==='string'?imageRaw:
    Array.isArray(imageRaw)&&imageRaw.length===1?
      (typeof imageRaw[0]==='string'?imageRaw[0]:imageRaw[0]?.url):null;
  const recordUrl=priced.url||product.url;
  const sourceUrl=new URL(recordUrl,page).href;
  const observedAt=new Date().toISOString();
  const digest=(await import('node:crypto')).createHash('sha256')
    .update(fetched.html).digest('hex');
  const recordId=(await import('node:crypto')).createHash('sha256')
    .update(JSON.stringify([digest,sourceUrl,sku,gtin,priced.price,priced.currency]))
    .digest('hex');
  return {
    provider:'url-resolver',providerMarket:page.hostname,merchant:merchantName(finalUrl),
    dataKind:'live',resolvedPageUrl:finalUrl,sourceUrl,observedAt,
    title:product.name,sku,gtin:gtin||null,image:image?new URL(image,page).href:null,
    condition:normalizeCondition(product.itemCondition||''),
    availability:normalizeAvailability(priced.availability),
    productPrice:priced.price,originalProductPrice:priced.price,
    currency:'SAR',originalCurrency:'SAR',
    specs:{brand,modelNumber:product.mpn||null,
      color:product.color||null,storage:product.storage||null,
      ram:product.ram||null,region:product.region||null,sim:product.sim||null,
      barcode:gtin},
    extraction:{
      selectedProductRecord:{
        recordId,documentDigest:digest,source:'jsonld_product_offer',
        productCount:products.length,selectedCount:declared.length,
        selectedProductUrl:product.url,selectedOfferUrl:sourceUrl
      },
      // This is a non-reconciled observation: every represented field comes
      // from the exact selected Product node and its single associated Offer.
      reconciled:false,conflictSummary:{hasConflicts:false},
      identity:{summary:{accepted:1,rejected:0}},
      availableStrategies:['jsonld'],
      // Source locations are restricted to this one selected JSON-LD
      // Product and its selected Offer, never hydrated siblings or meta tags.
      fieldSources:Object.fromEntries([
        'name','offers','image','sku','mpn','gtin','brand','color',
        ...(product.itemCondition?['condition']:[]),
        ...(priced.availability?['availability']:[]),
        ...(['storage','capacity','ram','region','sim','edition','bundleContents']
          .filter(k=>product[k]!=null&&product[k]!=='')) 
      ].map(key=>[key,{strategy:'jsonld',recordId}]))
    }
  };
}
