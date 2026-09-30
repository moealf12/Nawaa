import { moneyToSAR } from "../fx.mjs";
import { parseMoney } from "../provider-utils.mjs";

const SOURCES = [
  {
    id: "noon-sa",
    name: "noon",
    countryCode: "SA",
    countryNameAr: "السعودية",
    currency: "SAR",
    searchUrl: (q) => "https://www.noon.com/saudi-en/search/?q=" + encodeURIComponent(q),
  },
  {
    id: "jarir-sa",
    name: "Jarir",
    countryCode: "SA",
    countryNameAr: "السعودية",
    currency: "SAR",
    searchUrl: (q) => "https://www.jarir.com/sa-en/catalogsearch/result/?q=" + encodeURIComponent(q),
  },
  {
    id: "extra-sa",
    name: "eXtra",
    countryCode: "SA",
    countryNameAr: "السعودية",
    currency: "SAR",
    searchUrl: (q) => "https://www.extra.com/en-sa/search/?text=" + encodeURIComponent(q),
  },
];

function decode(value = "") {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function flatten(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => flatten(item, out));
    return out;
  }
  if (typeof node !== "object") return out;
  out.push(node);
  if (node["@graph"]) flatten(node["@graph"], out);
  if (node.itemListElement) flatten(node.itemListElement, out);
  if (node.item) flatten(node.item, out);
  return out;
}

function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[1].trim();
    if (!raw || raw.length > 1500000) continue;
    try { flatten(JSON.parse(raw), out); } catch {}
  }
  return out;
}

function productLike(node) {
  const type = node && node["@type"];
  if (Array.isArray(type)) return type.some((x) => String(x).toLowerCase() === "product");
  return String(type || "").toLowerCase() === "product";
}

function offerFromProduct(product) {
  const raw = product && product.offers;
  const offers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return offers
    .map((offer) => ({
      price: parseMoney(offer && (offer.price ?? offer.lowPrice)),
      currency: offer && offer.priceCurrency,
      url: offer && offer.url,
      availability: String(offer && offer.availability || "").toLowerCase(),
    }))
    .filter((x) => x.price !== null)
    .sort((a,b) => a.price - b.price)[0] || null;
}

function fallbackLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 80) {
    const label = decode(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (label.length < 8) continue;
    let url;
    try { url = new URL(decode(m[1]), baseUrl).href; } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title: label, url });
  }
  return out;
}

async function fetchSearch(source, query) {
  const url = source.searchUrl(query);
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; NAWAA-Price-Discovery/0.3; +https://moealf12.github.io/Nawaa/)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(source.id + ": HTTP " + response.status);
  const html = await response.text();
  if (html.length > 6000000) throw new Error(source.id + ": response too large");

  const products = jsonLd(html).filter(productLike);
  const offers = [];

  for (const product of products.slice(0, 30)) {
    const offer = offerFromProduct(product);
    if (!offer) continue;
    const currency = offer.currency || source.currency;
    const sar = currency === "SAR"
      ? { value: offer.price, rate: 1, source: "identity", observedAt: new Date().toISOString() }
      : await moneyToSAR(offer.price, currency).catch(() => null);
    if (!sar) continue;

    let sourceUrl = offer.url || product.url || url;
    try { sourceUrl = new URL(sourceUrl, url).href; } catch { sourceUrl = url; }

    const imageRaw = product.image;
    const image = Array.isArray(imageRaw) ? imageRaw[0] : imageRaw;

    offers.push({
      provider: source.id,
      providerMarket: source.id,
      merchant: source.name,
      merchantCountryCode: source.countryCode,
      merchantCountryNameAr: source.countryNameAr,
      sourceUrl,
      image: typeof image === "string" ? image : image && image.url || null,
      title: product.name || "Product",
      condition: "new",
      availability: offer.availability.includes("instock") ? "in_stock" : "unknown",
      canShipToSaudi: true,
      productPrice: sar.value,
      originalProductPrice: offer.price,
      shipping: null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      discount: 0,
      currency: "SAR",
      originalCurrency: currency,
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "incomplete",
      isLocal: true,
      deliveryDays: null,
      observedAt: new Date().toISOString(),
      dataKind: "live",
      fx: { rate: sar.rate, source: sar.source, observedAt: sar.observedAt },
    });
  }

  // Search pages with no structured prices are reported, never fabricated.
  return {
    provider: source.id,
    ok: offers.length > 0,
    offers,
    diagnostics: {
      structuredProducts: products.length,
      candidateLinks: offers.length ? 0 : fallbackLinks(html, url).length,
    },
  };
}

export async function searchSaudiRetailers(query) {
  const settled = await Promise.allSettled(SOURCES.map((source) => fetchSearch(source, query)));
  const offers = [];
  const errors = [];
  const searchedMarkets = [];

  settled.forEach((result, index) => {
    const source = SOURCES[index];
    searchedMarkets.push({ id: source.id, countryCode: source.countryCode, countryNameAr: source.countryNameAr });
    if (result.status === "fulfilled") {
      offers.push(...result.value.offers);
      if (!result.value.ok) errors.push({
        market: source.id,
        error: "No structured live offers found",
        diagnostics: result.value.diagnostics,
      });
    } else {
      errors.push({ market: source.id, error: result.reason?.message || String(result.reason) });
    }
  });

  return { provider: "saudi-retailers", ok: offers.length > 0, searchedMarkets, offers, errors };
}
