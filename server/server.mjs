import http from "node:http";
import { URL } from "node:url";
import { allowedOrigin, jsonResponse } from "./provider-utils.mjs";
import { ebayConfigured, searchEbayWorldwide } from "./providers/ebay.mjs";
import { searchConfiguredShopifyStores, shopifyConfigured } from "./providers/shopify.mjs";

const PORT = Number(process.env.PORT || 10000);

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ACCESSORY_TERMS = [
  "case","cover","screen protector","protector","charger","cable","adapter",
  "حافظه","كفر","شاحن","كيبل","سلك","حمايه","لزقه"
];

function assessMatch(query, offer) {
  const q = normalize(query).split(" ").filter(Boolean);
  const title = normalize(offer.title || "");
  if (!q.length || !title) return { exactMatch: false, matchConfidence: 0 };

  const hits = q.filter((token) => title.includes(token)).length;
  let confidence = hits / q.length;

  const queryHasAccessoryIntent = ACCESSORY_TERMS.some((term) => normalize(query).includes(term));
  const titleHasAccessory = ACCESSORY_TERMS.some((term) => title.includes(term));
  if (!queryHasAccessoryIntent && titleHasAccessory) confidence *= 0.35;

  const conditionPenalty = offer.condition !== "new" ? 0.15 : 0;
  confidence = Math.max(0, Math.min(1, confidence - conditionPenalty));

  return {
    exactMatch: confidence >= 0.92 && hits === q.length && !(!queryHasAccessoryIntent && titleHasAccessory),
    matchConfidence: Math.round(confidence * 100) / 100,
  };
}

function dedupeOffers(offers) {
  const seen = new Set();
  const out = [];
  for (const offer of offers) {
    const key = normalize([offer.provider, offer.sourceUrl, offer.title, offer.originalProductPrice, offer.originalCurrency].join("|"));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(offer);
  }
  return out;
}

async function searchAll(query) {
  const tasks = [];
  if (ebayConfigured()) tasks.push(searchEbayWorldwide(query));
  if (shopifyConfigured()) tasks.push(searchConfiguredShopifyStores(query));

  if (!tasks.length) {
    return {
      providersConfigured: [],
      providers: [],
      offers: [],
      errors: [{
        provider: "system",
        error: "No live providers configured yet. Configure eBay credentials and/or Shopify stores.",
      }],
    };
  }

  const settled = await Promise.allSettled(tasks);
  const providers = [];
  const errors = [];
  let offers = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      providers.push({
        provider: result.value.provider,
        ok: result.value.ok,
        searchedMarkets: result.value.searchedMarkets || result.value.searchedStores || [],
      });
      offers.push(...(result.value.offers || []));
      errors.push(...(result.value.errors || []).map((e) => ({ provider: result.value.provider, ...e })));
    } else {
      errors.push({ provider: "unknown", error: result.reason?.message || String(result.reason) });
    }
  }

  offers = dedupeOffers(offers).map((offer) => ({
    ...offer,
    ...assessMatch(query, offer),
    dataKind: "live",
  }));

  offers.sort((a, b) => {
    const match = (b.matchConfidence || 0) - (a.matchConfidence || 0);
    if (match !== 0) return match;
    const pa = Number.isFinite(a.productPrice) ? a.productPrice : Infinity;
    const pb = Number.isFinite(b.productPrice) ? b.productPrice : Infinity;
    return pa - pb;
  });

  return {
    providersConfigured: [
      ...(ebayConfigured() ? ["ebay"] : []),
      ...(shopifyConfigured() ? ["shopify"] : []),
    ],
    providers,
    offers: offers.slice(0, 120),
    errors,
  };
}

const server = http.createServer(async (req, res) => {
  const origin = allowedOrigin(req.headers.origin || "");
  if (req.method === "OPTIONS") {
    if (!origin) return jsonResponse(res, 403, { error: "origin_not_allowed" }, "null");
    res.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    });
    return res.end();
  }

  if (!origin && req.headers.origin) return jsonResponse(res, 403, { error: "origin_not_allowed" }, "null");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return jsonResponse(res, 200, {
      ok: true,
      service: "nawaa-search",
      liveProviders: {
        ebay: ebayConfigured(),
        shopify: shopifyConfigured(),
      },
      now: new Date().toISOString(),
    }, origin || "*");
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (q.length < 2 || q.length > 180) {
      return jsonResponse(res, 400, { error: "invalid_query" }, origin || "*");
    }

    try {
      const started = Date.now();
      const result = await searchAll(q);
      return jsonResponse(res, 200, {
        query: q,
        destinationCountry: "SA",
        observedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        ...result,
      }, origin || "*");
    } catch (error) {
      return jsonResponse(res, 500, {
        error: "search_failed",
        message: error instanceof Error ? error.message : String(error),
      }, origin || "*");
    }
  }

  return jsonResponse(res, 404, { error: "not_found" }, origin || "*");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NAWAA search backend listening on :${PORT}`);
});
