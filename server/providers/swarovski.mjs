const SWAROVSKI_SEARCH_BASE = "https://ar.swarovski.sa/search";

function decodeHtml(value = "") {
  return String(value)
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lrm;|&rlm;/gi, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
  const match = String(tag).match(new RegExp("\\b" + escaped + "=[\\\"']([^\\\"']*)[\\\"']", "i"));
  return match ? decodeHtml(match[1]).trim() : null;
}

function absoluteUrl(value) {
  const url = decodeHtml(value || "").trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return "https://ar.swarovski.sa" + (url.startsWith("/") ? url : "/" + url);
}

function firstTag(chunk, pattern) {
  return String(chunk).match(pattern)?.[0] || "";
}

function textFromTag(chunk, pattern) {
  const match = String(chunk).match(pattern);
  return match ? stripHtml(match[1]) : "";
}

function productTypeFromTitle(title = "") {
  const value = String(title);
  if (/عقد|قلاد/i.test(value)) return "Necklace";
  if (/سوار|أسور|اسور/i.test(value)) return "Bracelet";
  if (/خاتم/i.test(value)) return "Ring";
  if (/أقراط|اقراط|قرط/i.test(value)) return "Earrings";
  if (/ساعة|ساعه|ساعات/i.test(value)) return "Watch";
  if (/دلاية|دلايه|تعليقة|تعليقه/i.test(value)) return "Pendant";
  return null;
}

export function parseSwarovskiSearchHtml(html, limit = 32) {
  const source = String(html || "");
  const tileRe = /<div\b[^>]*class=["'][^"']*js-product-tile-container[^"']*["'][^>]*>/gi;
  const matches = [...source.matchAll(tileRe)];
  const offers = [];
  const seen = new Set();

  for (let index = 0; index < matches.length && offers.length < limit; index += 1) {
    const tileTag = matches[index][0];
    const productId = attr(tileTag, "data-pid");
    const sku = attr(tileTag, "data-sku");
    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    const chunk = source.slice(start, end);

    const anchor = firstTag(chunk, /<a\b[^>]*class=["'][^"']*\bproduct-tile\b[^"']*["'][^>]*>/i);
    const sourceUrl = absoluteUrl(attr(anchor, "href"));
    const imageTag = firstTag(chunk, /<img\b[^>]*class=["'][^"']*\btile-image\b[^"']*["'][^>]*>/i);
    const image = absoluteUrl(attr(imageTag, "src") || attr(imageTag, "data-src"));
    const title = textFromTag(chunk, /<h2\b[^>]*class=["'][^"']*\bpdp-link\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
    const subtitle = textFromTag(chunk, /<div\b[^>]*class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const priceTag = firstTag(chunk, /<span\b[^>]*class=["'][^"']*\bvalue\b[^"']*["'][^>]*>/i);
    const price = Number(String(attr(priceTag, "content") || "").replace(/,/g, ""));
    const inStock = /["']?item_in_stock["']?\s*:\s*true/i.test(chunk);

    if (!productId || !title || !Number.isFinite(price) || price <= 0 || !sourceUrl) continue;
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    const deviceType = productTypeFromTitle(title);
    offers.push({
      provider: "swarovski-direct",
      providerMarket: "swarovski-sa",
      merchant: "Swarovski Saudi",
      merchantCountryCode: "SA",
      merchantCountryNameAr: "السعودية",
      sourceUrl,
      image,
      title: subtitle ? title + " — " + subtitle : title,
      condition: "new",
      availability: inStock ? "in_stock" : "unknown",
      canShipToSaudi: true,
      productPrice: price,
      originalProductPrice: price,
      shipping: null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      discount: 0,
      currency: "SAR",
      originalCurrency: "SAR",
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "confirmed",
      isLocal: true,
      deliveryDays: null,
      observedAt: new Date().toISOString(),
      dataKind: "live",
      seller: { name: "Swarovski Saudi", type: "brand_store" },
      specs: {
        brand: "Swarovski",
        series: title,
        deviceType,
        modelNumber: productId,
        barcode: sku || null,
      },
      sourceMeta: {
        productId,
        sku: sku || null,
        subtitle: subtitle || null,
        officialStore: true,
        parsedFrom: "swarovski-sa-search",
      },
    });
  }

  return offers;
}

export async function searchSwarovskiSaudi(query, limit = 32) {
  const boundedLimit = Math.max(1, Math.min(40, Number(limit) || 32));
  const url = new URL(SWAROVSKI_SEARCH_BASE);
  url.searchParams.set("q", String(query || "").trim());
  url.searchParams.set("start", "0");
  url.searchParams.set("sz", String(Math.max(boundedLimit, 24)));

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ar-SA,ar;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.5; +https://moealf12.github.io/Nawaa/)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error("swarovski-direct: HTTP " + response.status);
    const offers = parseSwarovskiSearchHtml(await response.text(), boundedLimit);
    return {
      provider: "swarovski-direct",
      ok: offers.length > 0,
      searchedMarkets: [{ id: "swarovski-sa", countryCode: "SA", countryNameAr: "السعودية" }],
      offers,
      errors: offers.length ? [] : [{ market: "swarovski-sa", error: "No live products returned" }],
    };
  } catch (error) {
    return {
      provider: "swarovski-direct",
      ok: false,
      searchedMarkets: [{ id: "swarovski-sa", countryCode: "SA", countryNameAr: "السعودية" }],
      offers: [],
      errors: [{ market: "swarovski-sa", error: error instanceof Error ? error.message : String(error) }],
    };
  }
}
