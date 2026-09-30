import http from "node:http";
import { URL } from "node:url";
import { allowedOrigin, jsonResponse } from "./provider-utils.mjs";
import { ebayConfigured, searchEbayWorldwide } from "./providers/ebay.mjs";
import { searchConfiguredShopifyStores, shopifyConfigured } from "./providers/shopify.mjs";
import { assessOfferMatch, dedupeNormalizedOffers } from "./match.mjs";
import { resolveProductUrl } from "./url-resolver.mjs";
import { searchSaudiRetailers } from "./providers/saudi-retailers.mjs";
import { searchExtraUnbxd } from "./providers/extra-unbxd.mjs";
import { searchJarir } from "./providers/jarir.mjs";
import { noonConfigured, searchNoon } from "./providers/noon.mjs";

const PORT = Number(process.env.PORT || 10000);

async function searchAll(query) {
  const tasks = [searchExtraUnbxd(query), searchJarir(query)];
  if (noonConfigured()) tasks.push(searchNoon(query));
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

  offers = dedupeNormalizedOffers(offers).map((offer) => ({
    ...offer,
    ...assessOfferMatch(query, offer),
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
      "extra-unbxd",
      "jarir-direct",
      ...(noonConfigured() ? ["noon-catalog"] : []),
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
        extra: true,
        jarir: true,
        noon: noonConfigured(),
        ebay: ebayConfigured(),
        shopify: shopifyConfigured(),
      },
      now: new Date().toISOString(),
    }, origin || "*");
  }

  if (req.method === "GET" && url.pathname === "/api/resolve-url") {
    const target = String(url.searchParams.get("url") || "").trim();
    if (!target || target.length > 2000) {
      return jsonResponse(res, 400, { error: "invalid_url" }, origin || "*");
    }

    try {
      const offer = await resolveProductUrl(target);
      return jsonResponse(res, 200, {
        observedAt: new Date().toISOString(),
        destinationCountry: "SA",
        offer,
      }, origin || "*");
    } catch (error) {
      return jsonResponse(res, 422, {
        error: "url_resolution_failed",
        message: error instanceof Error ? error.message : String(error),
      }, origin || "*");
    }
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
