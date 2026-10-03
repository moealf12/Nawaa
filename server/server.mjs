import { createEbayDeletionHandler } from "./ebay-notifications.mjs";
import { sourceCoverageSummary } from "../src/source-registry.mjs";
import { configuredProviders, currentSources } from "./source-config.mjs";
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
import { extractNawaaProduct } from "./nawaa-extractor.mjs";
import { searchSaudiRetailers } from "./providers/saudi-retailers.mjs";
import { searchExtraUnbxd } from "./providers/extra-unbxd.mjs";
import { searchJarir } from "./providers/jarir.mjs";
import { noonConfigured, searchNoon } from "./providers/noon.mjs";
import { carrefourConfigured, searchCarrefour } from "./providers/carrefour.mjs";
import { searchSharafDG } from "./providers/sharafdg.mjs";
import { searchSwarovskiSaudi, swarovskiSaudiEligible } from "./providers/swarovski.mjs";
import { amazonCreatorsConfigured, configuredAmazonCreatorMarkets, searchAmazonCreators } from "./providers/amazon-creators.mjs";
import { configuredFreeStorefronts, searchFreeStorefronts } from "./providers/free-storefronts.mjs";
import { normalizeSearchQuery, parseSearchIntent, buildComparisonQuery, mergeComparisonOffers, buildProviderFallbackQueries } from "../src/search-query.mjs";
import { createSearchCache } from "./search-cache.mjs";
import { sourceReliability } from "./source-reliability.mjs";
import { auditFreeStorefronts } from "./source-audit.mjs";
import { createInternalAuditHandler } from "./internal-audit.mjs";

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

function providerTasks(providerQuery, matchingQuery) {
  const tasks = [];
  const add = (id, run, { explicit = false } = {}) => {
    if (!sourceReliability.shouldSkip(id, { explicit })) tasks.push({ id, run });
  };

  add("extra-unbxd", () => searchExtraUnbxd(providerQuery, 12, matchingQuery));
  add("jarir-direct", () => searchJarir(providerQuery, 24, matchingQuery));
  add("sharafdg-algolia", () => searchSharafDG(providerQuery));
  if (swarovskiSaudiEligible(providerQuery)) add("swarovski-direct", () => searchSwarovskiSaudi(providerQuery), { explicit:true });
  if (amazonCreatorsConfigured()) add("amazon-creators", () => searchAmazonCreators(providerQuery));
  add("free-storefronts", () => searchFreeStorefronts(providerQuery, {matchingQuery}));
  if (carrefourConfigured()) add("carrefour-ksa", () => searchCarrefour(providerQuery));
  if (noonConfigured()) add("noon-catalog", () => searchNoon(providerQuery));
  if (ebayConfigured()) add("ebay", () => searchEbayWorldwide(providerQuery));
  if (shopifyConfigured()) add("shopify", () => searchConfiguredShopifyStores(providerQuery));
  return tasks;
}

async function runProviderPass(providerQuery, pass = "primary", matchingQuery = providerQuery) {
  const tasks = providerTasks(providerQuery, matchingQuery);
  const settled = await Promise.allSettled(tasks.map(async (task) => {
    const started = Date.now();
    try {
      const value = await task.run();
      sourceReliability.record(task.id, {
        transportOk:true,
        offers:value.offers?.length || 0,
        latencyMs:Date.now() - started,
        relevant:true,
      });
      return { task, value };
    } catch (error) {
      sourceReliability.record(task.id, {
        transportOk:false,
        offers:0,
        latencyMs:Date.now() - started,
        relevant:true,
      });
      const wrapped = new Error(error instanceof Error ? error.message : String(error));
      wrapped.sourceId = task.id;
      throw wrapped;
    }
  }));
  const providers = [];
  const errors = [];
  const offers = [];

  settled.forEach((result, index) => {
    const sourceId = tasks[index]?.id || "unknown";
    if (result.status === "fulfilled") {
      const value = result.value.value;
      providers.push({
        provider: value.provider,
        sourceId,
        ok: value.ok,
        pass,
        query: providerQuery,
        reliability: sourceReliability.view(sourceId),
        searchedMarkets: value.searchedMarkets || value.searchedStores || [],
      });
      offers.push(...(value.offers || []));
      errors.push(...(value.errors || []).map((e) => ({ provider: value.provider, sourceId, pass, ...e })));
    } else {
      errors.push({
        provider: sourceId,
        sourceId,
        pass,
        error: result.reason?.message || String(result.reason),
        reliability: sourceReliability.view(sourceId),
      });
    }
  });

  return { providers, errors, offers };
}

async function searchAll(query) {
  query = normalizeSearchQuery(query);
  const providerQuery = parseSearchIntent(query).providerQuery;

  const primary = await runProviderPass(providerQuery, "primary", query);
  let providers = primary.providers;
  let errors = primary.errors;
  let offers = primary.offers;
  let fallbackQuery = null;

  if (!offers.length) {
    fallbackQuery = buildProviderFallbackQueries(query)[0] || null;
    if (fallbackQuery) {
      const fallback = await runProviderPass(fallbackQuery, "fallback", query);
      providers = providers.concat(fallback.providers);
      errors = errors.concat(fallback.errors);
      offers = offers.concat(fallback.offers);
    }
  }

  offers = dedupeNormalizedOffers(offers).map((offer) => ({
    ...offer,
    ...assessOfferMatch(query, offer),
    dataKind: "live",
  }));

  const sources = currentSources();
  const selectedOffers = selectDiverseOffers(offers, Infinity);
  return {
    providersConfigured: configuredProviders(),
    coverage: {
      ...sourceCoverageSummary(sources),
      returnedOffers: selectedOffers.length,
      availableOffers: offers.length,
      returnedMerchants: new Set(selectedOffers.map(offerMerchantKey)).size,
      truncated: selectedOffers.length < offers.length,
      fallbackUsed: Boolean(fallbackQuery),
    },
    providers,
    normalizedQuery: query,
    fallbackQuery,
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
const internalAudit = createInternalAuditHandler();

const server = http.createServer(async (req, res) => {
  const notificationUrl = new URL(req.url, "http://localhost");
  if (notificationUrl.pathname === "/internal/source-audit") {
    await internalAudit(req, res);
    return;
  }
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
    return jsonResponse(res, 200, {
      sources,
      coverage: sourceCoverageSummary(sources),
      runtimeReliability: sourceReliability.snapshot(),
    }, origin);
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
        amazonCreators: amazonCreatorsConfigured() ? configuredAmazonCreatorMarkets().map((market) => market.id) : [],
        freeStorefronts: configuredFreeStorefronts().map((store) => store.id),
        carrefour: carrefourConfigured(),
        noon: noonConfigured(),
        ebay: ebayConfigured(),
        shopify: shopifyConfigured(),
      },
      sourceReliability: sourceReliability.snapshot(),
      now: new Date().toISOString(),
    }, origin || "*");
  }

  if (req.method === "GET" && url.pathname === "/api/source-audit") {
    const storeId = String(url.searchParams.get("store") || "").trim() || null;
    const query = String(url.searchParams.get("q") || "").trim() || null;
    try {
      const audit = await auditFreeStorefronts({ storeId, query });
      return jsonResponse(res, 200, audit, origin || "*");
    } catch (error) {
      return jsonResponse(res, 400, {
        error:"source_audit_failed",
        message:error instanceof Error ? error.message : String(error),
      }, origin || "*");
    }
  }

  if (req.method === "GET" && url.pathname === "/api/extract") {
    const target = String(url.searchParams.get("url") || "").trim();
    if (!target || target.length > 2000) {
      return jsonResponse(res, 400, { error: "invalid_url" }, origin || "*");
    }

    const result = await extractNawaaProduct(target);
    return jsonResponse(res, result.ok ? 200 : 422, result, origin || "*");
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
