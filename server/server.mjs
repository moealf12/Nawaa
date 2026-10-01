import { createEbayDeletionHandler } from "./ebay-notifications.mjs";
import { buildSourceRegistry, sourceCoverageSummary } from "../src/source-registry.mjs";
import { selectDiverseOffers, offerMerchantKey } from "./offer-selection.mjs";
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { allowedOrigin, jsonResponse } from "./provider-utils.mjs";
import { ebayConfigured, searchEbayWorldwide } from "./providers/ebay.mjs";
import { searchConfiguredShopifyStores, shopifyConfigured, configuredShopifyStores } from "./providers/shopify.mjs";
import { assessOfferMatch, dedupeNormalizedOffers } from "./match.mjs";
import { resolveProductUrl } from "./url-resolver.mjs";
import { searchSaudiRetailers } from "./providers/saudi-retailers.mjs";
import { searchExtraUnbxd } from "./providers/extra-unbxd.mjs";
import { searchJarir } from "./providers/jarir.mjs";
import { noonConfigured, searchNoon } from "./providers/noon.mjs";
import { carrefourConfigured, searchCarrefour } from "./providers/carrefour.mjs";
import { searchSharafDG } from "./providers/sharafdg.mjs";
import { searchSwarovskiSaudi } from "./providers/swarovski.mjs";
import { normalizeSearchQuery, parseSearchIntent, buildComparisonQuery, mergeComparisonOffers } from "../src/search-query.mjs";
import { createSearchCache } from "./search-cache.mjs";

const PORT = Number(process.env.PORT || 10000);
const STATIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/search.html", "search.html"],
  ["/product.html", "product.html"],
  ["/config.js", "config.js"],
  ["/src/search-page.mjs", "src/search-page.mjs"],
  ["/src/search-core.mjs", "src/search-core.mjs"],
  ["/src/search-query.mjs", "src/search-query.mjs"],
  ["/src/product-page.mjs", "src/product-page.mjs"],
  ["/src/source-registry.mjs", "src/source-registry.mjs"],
]);

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

async function serveStaticFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const relative = STATIC_FILES.get(pathname);
  if (!relative) return false;

  const filePath = path.join(STATIC_ROOT, relative);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      "content-type": contentTypeFor(filePath),
      "content-length": String(info.size),
      "cache-control": filePath.endsWith(".html") ? "no-cache" : "public, max-age=60",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") return res.end(), true;
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function configuredProviders() {
  return ["extra-unbxd", "jarir-direct", "sharafdg-algolia", "swarovski-direct",
    ...(carrefourConfigured() ? ["carrefour-ksa"] : []),
    ...(noonConfigured() ? ["noon-catalog"] : []),
    ...(ebayConfigured() ? ["ebay"] : []),
    ...(shopifyConfigured() ? ["shopify"] : [])];
}
function currentSources() {
  return buildSourceRegistry({configuredProviders:configuredProviders(),shopifyStores:configuredShopifyStores()});
}

async function searchAll(query) {
  query = normalizeSearchQuery(query);
  const providerQuery = parseSearchIntent(query).providerQuery;
  const tasks = [searchExtraUnbxd(providerQuery), searchJarir(providerQuery), searchSharafDG(providerQuery), searchSwarovskiSaudi(providerQuery)];
  if (carrefourConfigured()) tasks.push(searchCarrefour(providerQuery));
  if (noonConfigured()) tasks.push(searchNoon(providerQuery));
  if (ebayConfigured()) tasks.push(searchEbayWorldwide(providerQuery));
  if (shopifyConfigured()) tasks.push(searchConfiguredShopifyStores(providerQuery));

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

  const sources = currentSources();
  const selectedOffers = selectDiverseOffers(offers, 120);
  return {
    providersConfigured: configuredProviders(),
    coverage: {
      ...sourceCoverageSummary(sources),
      returnedOffers: selectedOffers.length,
      availableOffers: offers.length,
      returnedMerchants: new Set(selectedOffers.map(offerMerchantKey)).size,
      truncated: selectedOffers.length < offers.length,
    },
    providers,
    normalizedQuery: query,
    offers: selectedOffers,
    errors,
  };
}

const cachedSearch = createSearchCache(searchAll);
const ebayDeletion = createEbayDeletionHandler({
  token: process.env.EBAY_DELETION_VERIFICATION_TOKEN,
  endpoint: process.env.EBAY_DELETION_ENDPOINT,
  onDelete: () => cachedSearch.clear(),
});

const server = http.createServer(async (req, res) => {
  const notificationUrl = new URL(req.url, "http://localhost");
  if (notificationUrl.pathname === "/api/ebay/account-deletion") {
    await ebayDeletion(req, res, notificationUrl);
    return;
  }
  const origin = allowedOrigin(req.headers.origin || "");
  if (req.method === "OPTIONS") {
    if (!origin) return jsonResponse(res, 403, { error: "origin_not_allowed" }, "null");
    res.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "accept,content-type",
      "access-control-max-age": "86400",
    });
    return res.end();
  }

  if (!origin && req.headers.origin) return jsonResponse(res, 403, { error: "origin_not_allowed" }, "null");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/sources") {
    const sources = currentSources();
    return jsonResponse(res, 200, { sources, coverage: sourceCoverageSummary(sources) }, origin);
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return jsonResponse(res, 200, {
      ok: true,
      service: "nawaa-search",
      apiVersion: "0.5.0",
      revision: process.env.RENDER_GIT_COMMIT || null,
      liveProviders: {
        extra: true,
        jarir: true,
        sharafdg: true,
        swarovski: true,
        carrefour: carrefourConfigured(),
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
    const productUrl = String(url.searchParams.get("url") || "").trim();
    if (productUrl ? productUrl.length > 2000 : q.length < 2 || q.length > 180) {
      return jsonResponse(res, 400, { error: "invalid_query" }, origin || "*");
    }

    try {
      const started = Date.now();
      const resolvedOffer = productUrl ? await resolveProductUrl(productUrl) : null;
      const comparisonQuery = resolvedOffer ? buildComparisonQuery(resolvedOffer) : q;
      if (comparisonQuery.length < 2) throw new Error("Product identity could not be extracted");
      const result = await cachedSearch(normalizeSearchQuery(comparisonQuery));
      if (resolvedOffer) result.offers = mergeComparisonOffers(resolvedOffer, result.offers);
      return jsonResponse(res, 200, {
        query: productUrl || q,
        comparisonQuery: resolvedOffer ? comparisonQuery : null,
        resolvedOffer,
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

  if (await serveStaticFile(req, res, url.pathname)) return;

  return jsonResponse(res, 404, { error: "not_found" }, origin || "*");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NAWAA search backend listening on :${PORT}`);
});
