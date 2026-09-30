const EXTRA_API_KEY = "21705619e273429e5767eea44ccb1ad5";
const EXTRA_SITE_KEY = "ss-unbxd-auk-extra-saudi-en-prod11541714990488";
const EXTRA_SEARCH_BASE = `https://search.unbxd.io/${EXTRA_API_KEY}/${EXTRA_SITE_KEY}/search`;

function firstFinite(...values) {
  for (const value of values) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  }
  return null;
}

function absoluteMedia(value) {
  if (!value) return null;
  if (value.startsWith("//")) return "https:" + value;
  return value;
}

function boolish(value) {
  if (typeof value === "boolean") return value;
  const s = String(value || "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function normalizeProduct(product) {
  const id = String(
    product?._root_ ??
    product?.uniqueId ??
    product?.productId ??
    product?.id ??
    product?.code ??
    ""
  ).trim();

  const title = firstString(
    product?.name,
    product?.productName,
    product?.title,
    product?.autosuggest,
    product?.autosuggest_unstemmed
  );

  const price = firstFinite(
    product?.currentPrice,
    product?.sellingPrice,
    product?.specialPrice,
    product?.basicPriceValueDiscount,
    product?.priceValue,
    product?.price
  );

  const image = absoluteMedia(firstString(
    product?.imageUrl,
    product?.image,
    product?.amplienceProductBaseUrl
  ));

  if (!id || !title || price === null) return null;

  const available = boolish(product?.available);
  const homeDelivery = boolish(product?.homeDeliveryEnabled);
  const jeddahInStock = Array.isArray(product?.inStock)
    ? product.inStock.includes("SA-jeddah_inStock")
    : null;

  return {
    provider: "extra-unbxd",
    providerMarket: "extra-sa",
    merchant: "eXtra",
    merchantCountryCode: "SA",
    merchantCountryNameAr: "السعودية",
    sourceUrl: `https://www.extra.com/en-sa/p/${encodeURIComponent(id)}`,
    image,
    title,
    condition: "new",
    availability: available || jeddahInStock === true ? "in_stock" : "unknown",
    canShipToSaudi: homeDelivery || available ? true : null,
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
    observedAt: new Date().toISOString(),
    dataKind: "live",
    seller: { name: "eXtra", type: "retailer" },
    sourceMeta: {
      productId: id,
      color: firstString(product?.featureEnColor),
      storage: firstString(product?.featureEnMemoryInternal),
      jeddahInStock,
      homeDeliveryEnabled: homeDelivery,
    },
  };
}

export async function searchExtraUnbxd(query, limit = 12) {
  const url = new URL(EXTRA_SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("rows", String(Math.max(1, Math.min(24, limit))));
  url.searchParams.set("start", "0");
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "NAWAA-Search/0.3 (+https://moealf12.github.io/Nawaa/)",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error("extra-unbxd: HTTP " + response.status);
  }

  const data = await response.json();
  const products = Array.isArray(data?.response?.products) ? data.response.products : [];
  const offers = products.map(normalizeProduct).filter(Boolean);

  return {
    provider: "extra-unbxd",
    ok: offers.length > 0,
    searchedMarkets: [{ id: "extra-sa", countryCode: "SA", countryNameAr: "السعودية" }],
    offers,
    errors: offers.length ? [] : [{ market: "extra-sa", error: "No live products returned" }],
  };
}
