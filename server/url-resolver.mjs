import dns from "node:dns/promises";
import net from "node:net";
import { moneyToSAR } from "./fx.mjs";
import { normalizeCondition, parseMoney } from "./provider-utils.mjs";

const MAX_HTML_BYTES = 8000000;
const MAX_REDIRECTS = 4;

function isPrivateIpv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  const a = p[0], b = p[1];
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(ip) {
  const value = ip.toLowerCase();
  return value === "::1" || value === "::" ||
    value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

async function assertPublicHttps(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS product URLs are allowed");
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error("Invalid product URL");
  if (parsed.port && parsed.port !== "443") throw new Error("Non-standard ports are not allowed");

  const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("Host could not be resolved");
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error("Private/internal addresses are not allowed");
  }
  return parsed;
}

async function fetchHtmlSafe(url, redirects = 0) {
  const parsed = await assertPublicHttps(url);
  const response = await fetch(parsed, {
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "NAWAA-Product-Resolver/0.2 (+https://moealf12.github.io/Nawaa/)",
    },
    signal: AbortSignal.timeout(12000),
  });

  if ([301,302,303,307,308].includes(response.status)) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect without location");
    return fetchHtmlSafe(new URL(location, parsed).href, redirects + 1);
  }

  if (!response.ok) throw new Error("Product page returned " + response.status);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
    throw new Error("URL is not an HTML product page");
  }

  const reader = response.body && response.body.getReader();
  if (!reader) throw new Error("Product page body unavailable");

  let total = 0;
  const chunks = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("Product page is too large");
    }
    chunks.push(part.value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { finalUrl: parsed.href, html: new TextDecoder().decode(merged) };
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

export async function resolveProductUrl(url) {
  const fetched = await fetchHtmlSafe(url);
  const html = fetched.html;
  const finalUrl = fetched.finalUrl;

  const nodes = extractJsonLd(html);
  const products = nodes.filter((node) => typeIncludesProduct(node && node["@type"]));
  const product = products.find((p) => chooseOffer(p)) || products[0] || null;
  const offer = chooseOffer(product);

  const title = product && product.name || titleFromHtml(html) || null;
  const imageRaw = product && product.image;
  const image = Array.isArray(imageRaw)
    ? (typeof imageRaw[0] === "string" ? imageRaw[0] : imageRaw[0] && imageRaw[0].url)
    : (typeof imageRaw === "string" ? imageRaw : imageRaw && imageRaw.url) || imageFromHtml(html);

  const originalPrice = (offer && offer.price) ?? parseMoney(
    metaContent(html, "product:price:amount") ||
    metaContent(html, "og:price:amount") ||
    metaContent(html, "twitter:data1", "name")
  );
  const originalCurrency = (offer && offer.currency) ||
    metaContent(html, "product:price:currency") ||
    metaContent(html, "og:price:currency") ||
    null;

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
    image: image ? new URL(image, finalUrl).href : null,
    title: title || "منتج من رابط خارجي",
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
    observedAt: new Date().toISOString(),
    dataKind: "live",
    fx: priceSAR ? { rate: priceSAR.rate, source: priceSAR.source, observedAt: priceSAR.observedAt } : null,
    extraction: {
      jsonLdProductFound: Boolean(product),
      structuredPriceFound: originalPrice !== null,
      structuredCurrencyFound: Boolean(originalCurrency)
    }
  };
}
