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
import { configuredFreeStorefronts, searchFreeStorefronts, searchFreeStorefrontById } from "./providers/free-storefronts.mjs";
import { normalizeSearchQuery, parseSearchIntent, buildComparisonQuery, mergeComparisonOffers, buildProviderFallbackQueries } from "../src/search-query.mjs";
import { createSearchCache } from "./search-cache.mjs";
import { sourceReliability } from "./source-reliability.mjs";
import { auditFreeStorefronts } from "./source-audit.mjs";
import { createInternalAuditHandler } from "./internal-audit.mjs";
import { persistOffers, searchPersistedOffers } from "./persistence.mjs";
import { upsertPimProduct, pimConfigured } from "./pim-bridge.mjs";
import { normalizeIngestBatch } from "./ingestion.mjs";
import { indexOffers, searchIndexedOffers } from "./search-index.mjs";

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

function providerTasks(providerQuery, matchingQuery, { skipFreeStorefronts = false } = {}) {
  const tasks = [];
  const add = (id, run, { explicit = false, deadlineMs = null } = {}) => {
    if (!sourceReliability.shouldSkip(id, { explicit })) tasks.push({ id, run, deadlineMs });
  };

  // Core search providers must always get a chance per user request. Reliability
  // still affects diagnostics/routing inside providers, but a temporary cooldown
  // must not collapse the whole public API into an instant empty response.
  add("extra-unbxd", () => searchExtraUnbxd(providerQuery, 12, matchingQuery), { explicit:true });
  add("jarir-direct", () => searchJarir(providerQuery, 24, matchingQuery), { explicit:true });
  add("sharafdg-algolia", () => searchSharafDG(providerQuery), { explicit:true });
  if (swarovskiSaudiEligible(providerQuery)) add("swarovski-direct", () => searchSwarovskiSaudi(providerQuery), { explicit:true });
  if (amazonCreatorsConfigured()) add("amazon-creators", () => searchAmazonCreators(providerQuery));
  if (!skipFreeStorefronts) {
    add("free-storefronts", () => searchFreeStorefronts(providerQuery, { matchingQuery, excludeStoreIds:["amazon-sa"] }), { explicit:true, deadlineMs:6000 });
  }
  if (carrefourConfigured()) add("carrefour-ksa", () => searchCarrefour(providerQuery));
  if (noonConfigured()) add("noon-catalog", () => searchNoon(providerQuery));
  if (ebayConfigured()) add("ebay", () => searchEbayWorldwide(providerQuery));
  if (shopifyConfigured()) add("shopify", () => searchConfiguredShopifyStores(providerQuery));
  return tasks;
}

async function runProviderPass(providerQuery, pass = "primary", matchingQuery = providerQuery, options = {}) {
  const tasks = providerTasks(providerQuery, matchingQuery, options);
  const providerDeadlineMs = Number(process.env.SEARCH_PROVIDER_DEADLINE_MS || 4200);
  const withDeadline = (promise, sourceId, deadlineMs = providerDeadlineMs) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("provider_deadline_exceeded:" + sourceId)), deadlineMs)),
  ]);
  const settled = await Promise.allSettled(tasks.map(async (task) => {
    const started = Date.now();
    try {
      const value = await withDeadline(Promise.resolve().then(() => task.run()), task.id, task.deadlineMs);
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

  // Amazon Saudi is a high-recall direct search-card source. Run it independently
  // from the broad storefront aggregator so slower stores cannot make Amazon miss
  // the aggregator deadline and collapse a valid search to zero offers.
  const amazonSaudi = searchFreeStorefrontById("amazon-sa", providerQuery, {
    perStore: Infinity,
    matchingQuery: query,
  }).catch((error) => ({ offers:[], error:error instanceof Error ? error.message : String(error) }));
  const [primary,indexed,persisted,amazon] = await Promise.all([
    runProviderPass(providerQuery, "primary", query, { skipFreeStorefronts:true }),
    searchIndexedOffers(query).catch(() => ({ configured:false, offers:[] })),
    searchPersistedOffers(query).catch(() => ({ configured:false, offers:[] })),
    amazonSaudi,
  ]);
  let providers = primary.providers;
  let errors = primary.errors;
  const amazonValidated = dedupeNormalizedOffers(amazon.offers || []).map((offer) => ({
    ...offer,
    dataKind:"live",
    matchConfidence:Number.isFinite(offer.matchConfidence) ? offer.matchConfidence : 0.9,
  }));
  let offers = primary.offers;
  let fallbackQuery = null;

  // Durable catalog recall is merged with live providers and re-scored against
  // the current shopper query. PostgreSQL keeps search useful even if Meili is absent.
  offers.push(...amazonValidated, ...(indexed.offers || []), ...(persisted.offers || []));

  // Do not let a handful of weak primary hits suppress recall expansion.
  // Expand when the first pass has too few relevant offers or too little merchant diversity.
  const primaryAssessed = dedupeNormalizedOffers(offers).map((offer) => ({
    ...offer,
    ...assessOfferMatch(query, offer),
  }));
  const relevantPrimary = primaryAssessed.filter((offer) => (offer.matchConfidence || 0) >= 0.65);
  const primaryMerchants = new Set(relevantPrimary.map(offerMerchantKey)).size;
  const intent = parseSearchIntent(query);
  const broadDiscovery = intent.discoveryMode === "brand" || (!intent.model && !intent.storage && !intent.color && !intent.condition);
  const minimumUsefulOffers = broadDiscovery ? 20 : 6;
  const needsRecallExpansion = amazonValidated.length >= 10 ? false :
    relevantPrimary.length < minimumUsefulOffers ||
    (broadDiscovery && primaryMerchants < 2 && relevantPrimary.length < 40);
  if (needsRecallExpansion) {
    const fallbackQueries = buildProviderFallbackQueries(query);
    fallbackQuery = fallbackQueries[0] || null;
    // Brand-only searches need breadth across product families. Run up to four
    // distinct category expansions in parallel, while specific searches keep
    // the single bounded fallback path.
    const expansionQueries = parseSearchIntent(query).discoveryMode === "brand"
      ? fallbackQueries.slice(0, 4)
      : fallbackQueries.slice(0, 1);
    if (expansionQueries.length) {
      const expansions = await Promise.all(expansionQueries.map((candidate) => runProviderPass(candidate, "fallback", query)));
      for (const fallback of expansions) {
        providers = providers.concat(fallback.providers);
        errors = errors.concat(fallback.errors);
        offers = offers.concat(fallback.offers);
      }
    }
  }

  const amazonUrls = new Set(amazonValidated.map((offer) => offer.sourceUrl).filter(Boolean));
  const rescoredOffers = dedupeNormalizedOffers(offers)
    .filter((offer) => !amazonUrls.has(offer.sourceUrl))
    .map((offer) => ({
      ...offer,
      ...assessOfferMatch(query, offer),
      dataKind: "live",
    }))
    .filter((offer) => (offer.matchConfidence || 0) >= 0.65);
  // Amazon offers have already passed the storefront-level query filter. Keep
  // them intact here instead of making a second scoring pass silently discard
  // verified results.
  offers = dedupeNormalizedOffers([...amazonValidated, ...rescoredOffers]);

  const sources = currentSources();
  const selectedOffers = selectDiverseOffers(offers, Infinity);

  // Persistence/indexing are optional accelerators and must never delay the
  // shopper response. Write-through happens asynchronously after live results
  // are ready; failures are intentionally isolated from the search request.
  void Promise.allSettled([
    persistOffers(query, selectedOffers),
    indexOffers(selectedOffers),
  ]).catch(() => {});

  return {
    providersConfigured: configuredProviders(),
    coverage: {
      ...sourceCoverageSummary(sources),
      amazonDirectOffers: amazonValidated.length,
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

async function readJsonBody(req,{maxBytes=1000000}={}){
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error("payload_too_large");chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
}
function ingestAuthorized(req){
  const expected=process.env.NAWAA_INGEST_TOKEN;
  if(!expected)return false;
  const auth=String(req.headers.authorization||"");
  return auth===`Bearer ${expected}`;
}

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
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "accept,content-type,authorization",
      "access-control-max-age": "86400",
    });
    return res.end();
  }

  if (!origin && req.headers.origin) return jsonResponse(res, 403, { error: "origin_not_allowed" }, "null");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "POST" && url.pathname === "/api/ingest/offers") {
    if (!ingestAuthorized(req)) return jsonResponse(res, 401, { error:"unauthorized" }, origin || "*");
    try {
      const body=await readJsonBody(req);
      const valid=normalizeIngestBatch(body.offers);
      if(!valid.length)return jsonResponse(res,422,{error:"no_valid_offers"},origin||"*");
      const [stored,indexed]=await Promise.all([persistOffers(String(body.source||"crawler"),valid),indexOffers(valid)]);
      cachedSearch.clear();
      return jsonResponse(res,202,{accepted:valid.length,stored,indexed},origin||"*");
    } catch(error) {
      return jsonResponse(res,error?.message==="payload_too_large"?413:400,{error:"ingest_failed",message:error instanceof Error?error.message:String(error)},origin||"*");
    }
  }

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
    if (result.ok && pimConfigured()) {
      const pim = await upsertPimProduct(result.product).catch(error => ({configured:true,synced:false,error:error instanceof Error?error.message:String(error)}));
      result.pim = pim;
    }
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
