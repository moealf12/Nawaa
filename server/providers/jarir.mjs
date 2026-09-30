function decode(value = "") {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/");
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
  const match = String(tag).match(new RegExp("\\b" + escaped + "=[\\\"']([^\\\"']*)[\\\"']", "i"));
  return match ? decode(match[1]) : null;
}

function firstImage(chunk, title) {
  const tags = String(chunk).match(/<img\b[^>]*>/gi) || [];
  const normalizedTitle = String(title || "").toLowerCase();
  for (const tag of tags) {
    const src = attr(tag, "src");
    if (!src) continue;
    const alt = String(attr(tag, "alt") || "").toLowerCase();
    if (alt && normalizedTitle && alt === normalizedTitle) return src;
  }
  return tags.length ? attr(tags[0], "src") : null;
}

function firstProductUrl(chunk, productId) {
  const links = String(chunk).match(/<a\b[^>]*>/gi) || [];
  for (const tag of links) {
    const href = attr(tag, "href");
    const id = attr(tag, "data-product-id");
    if (href && (!productId || id === productId) && /jarir\.com\/sa-en\//i.test(href)) return href;
  }
  return null;
}

function specsFromTitle(title) {
  const parts = String(title || "").split(",").map((x) => x.trim()).filter(Boolean);
  const storageIndex = parts.findIndex((part) => /\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i.test(part));
  const storage = storageIndex >= 0 ? parts[storageIndex].match(/\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i)?.[0] || null : null;
  const color = storageIndex >= 0 && parts[storageIndex + 1] && !/^(?:4G|5G|LTE)$/i.test(parts[storageIndex + 1])
    ? parts[storageIndex + 1]
    : null;
  const network = parts.find((part) => /^(?:4G|5G|LTE)$/i.test(part)) || null;
  const processor = [...parts].reverse().find((part) => /\b(?:Apple\s+)?A\d+|Bionic|Snapdragon|Exynos|Dimensity/i.test(part)) || null;

  let brand = null;
  if (/\bApple\b/i.test(title)) brand = "APPLE";
  else if (/\bSamsung\b/i.test(title)) brand = "SAMSUNG";
  else if (/\bHuawei\b/i.test(title)) brand = "HUAWEI";
  else if (/\bXiaomi\b/i.test(title)) brand = "XIAOMI";
  else if (/\bHonor\b/i.test(title)) brand = "HONOR";

  const series = parts[0]
    ? parts[0].replace(/^Renewed\s+Grade\s+[A-Z]\s+/i, "").trim()
    : null;

  return { brand, series, deviceType: series, color, storage, network, processor };
}

export function parseJarirSearchHtml(html, limit = 24) {
  const source = String(html || "");
  const tileRe = /<div\b[^>]*class=["'][^"']*product-tile__item--spacer[^"']*["'][^>]*>/gi;
  const matches = [...source.matchAll(tileRe)];
  const offers = [];
  const seen = new Set();

  for (let index = 0; index < matches.length && offers.length < limit; index++) {
    const tag = matches[index][0];
    const productId = attr(tag, "data-cnstrc-item-id");
    const title = attr(tag, "data-cnstrc-item-name");
    const rawPrice = attr(tag, "data-cnstrc-item-price");
    const price = Number(String(rawPrice || "").replace(/,/g, ""));

    if (!productId || !title || !Number.isFinite(price) || price <= 0) continue;

    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    const chunk = source.slice(start, end);

    const sourceUrl = firstProductUrl(chunk, productId) || ("https://www.jarir.com/sa-en/catalogsearch/result/?q=" + encodeURIComponent(title));
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    const image = firstImage(chunk, title);
    const addToCart = /Add\s+to\s+Cart/i.test(chunk);
    const renewed = /\bRenewed\b/i.test(title);
    const observedAt = new Date().toISOString();

    offers.push({
      provider: "jarir-direct",
      providerMarket: "jarir-sa",
      merchant: "Jarir",
      merchantCountryCode: "SA",
      merchantCountryNameAr: "السعودية",
      sourceUrl,
      image,
      title,
      condition: renewed ? "renewed" : "new",
      availability: addToCart ? "in_stock" : "unknown",
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
      priceConfidence: "incomplete",
      isLocal: true,
      deliveryDays: null,
      observedAt,
      dataKind: "live",
      seller: { name: "Jarir", type: "retailer" },
      specs: specsFromTitle(title),
      sourceMeta: {
        productId,
        addToCart,
        parsedFrom: "jarir-search-page",
      },
    });
  }

  return offers;
}

export async function searchJarir(query, limit = 24) {
  const url = "https://www.jarir.com/sa-en/catalogsearch/result/?q=" + encodeURIComponent(query);
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.4; +https://moealf12.github.io/Nawaa/)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) throw new Error("jarir-direct: HTTP " + response.status);

  const html = await response.text();
  if (html.length > 10000000) throw new Error("jarir-direct: response too large");

  const offers = parseJarirSearchHtml(html, Math.max(1, Math.min(48, limit)));

  return {
    provider: "jarir-direct",
    ok: offers.length > 0,
    searchedMarkets: [{ id: "jarir-sa", countryCode: "SA", countryNameAr: "السعودية" }],
    offers,
    errors: offers.length ? [] : [{ market: "jarir-sa", error: "No Jarir product tiles found" }],
  };
}
