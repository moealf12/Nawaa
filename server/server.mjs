import { createEbayDeletionHandler } from "./ebay-notifications.mjs";
import { sourceCoverageSummary } from "../src/source-registry.mjs";
import { configuredProviders, currentSources } from "./source-config.mjs";
import { selectDiverseOffers, offerMerchantKey } from "./offer-selection.mjs";
import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
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
import { persistOffers, recordOffer, searchPersistedOffers } from "./persistence.mjs";
import { upsertPimProduct, pimConfigured } from "./pim-bridge.mjs";
import { normalizeIngestBatch } from "./ingestion.mjs";
import { indexOffers, searchIndexedOffers } from "./search-index.mjs";
import { createRateLimiter, requestClientKey } from "./rate-limit.mjs";
import { acquisitionPlan, decodeSearchCursor, encodeSearchCursor, MAX_SEARCH_DEPTH } from "./search-cursor.mjs";

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
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    });
    if (req.method === "HEAD") return res.end(), true;
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function providerTasks(providerQuery, matchingQuery, { skipFreeStorefronts = false, plan = acquisitionPlan(0, configuredFreeStorefronts().length) } = {}) {
  const tasks = [];
  const add = (id, run, { explicit = false, deadlineMs = null } = {}) => {
    if (!sourceReliability.shouldSkip(id, { explicit })) tasks.push({ id, run, deadlineMs });
  };

  // Core search providers must always get a chance per user request. Reliability
  // still affects diagnostics/routing inside providers, but a temporary cooldown
  // must not collapse the whole public API into an instant empty response.
  add("extra-unbxd", () => searchExtraUnbxd(providerQuery, Infinity, matchingQuery), { explicit:true, deadlineMs:8000 });
  add("jarir-direct", () => searchJarir(providerQuery, plan.jarirLimit, matchingQuery), { explicit:true, deadlineMs:8000 });
  add("sharafdg-algolia", () => searchSharafDG(providerQuery), { explicit:true, deadlineMs:8000 });
  if (swarovskiSaudiEligible(providerQuery)) add("swarovski-direct", () => searchSwarovskiSaudi(providerQuery), { explicit:true });
  if (amazonCreatorsConfigured()) add("amazon-creators", () => searchAmazonCreators(providerQuery));
  if (!skipFreeStorefronts) {
    add("free-storefronts", () => searchFreeStorefronts(providerQuery, {
      matchingQuery,
      excludeStoreIds:["amazon-sa"],
      storeOffset:plan.storefrontOffset,
      storeLimit:plan.storefrontLimit,
      stableRouting:true,
      productPageLimit:plan.productPageLimit,
      catalogLimit:Infinity,
      storeDeadlineMs:6500,
    }), { explicit:true, deadlineMs:7500 });
  }
  if (carrefourConfigured()) add("carrefour-ksa", () => searchCarrefour(providerQuery));
  if (noonConfigured()) add("noon-catalog", () => searchNoon(providerQuery));
  if (ebayConfigured()) add("ebay", () => searchEbayWorldwide(providerQuery));
  if (shopifyConfigured()) add("shopify", () => searchConfiguredShopifyStores(providerQuery));
  return tasks;
}

async function executeProviderTask(task, pass, providerQuery) {
  const providerDeadlineMs = Number(process.env.SEARCH_PROVIDER_DEADLINE_MS || 4200);
  const deadlineMs = task.deadlineMs || providerDeadlineMs;
  const started = Date.now();
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => task.run()),
      new Promise((_, reject) => setTimeout(() => reject(new Error("provider_deadline_exceeded:" + task.id)), deadlineMs)),
    ]);
    sourceReliability.record(task.id, {
      transportOk:true,
      offers:value.offers?.length || 0,
      latencyMs:Date.now() - started,
      relevant:true,
    });
    return {
      provider:{
        provider:value.provider,
        sourceId:task.id,
        ok:value.ok,
        pass,
        query:providerQuery,
        reliability:sourceReliability.view(task.id),
        diagnostics:value.diagnostics || null,
        returnedOffers:value.offers?.length || 0,
        searchedMarkets:value.searchedMarkets || value.searchedStores || [],
      },
      offers:value.offers || [],
      errors:(value.errors || []).map((error)=>({provider:value.provider,sourceId:task.id,pass,...error})),
    };
  } catch (error) {
    sourceReliability.record(task.id, {
      transportOk:false,
      offers:0,
      latencyMs:Date.now() - started,
      relevant:true,
    });
    return {
      provider:null,
      offers:[],
      errors:[{
        provider:task.id,
        sourceId:task.id,
        pass,
        error:error instanceof Error ? error.message : String(error),
        reliability:sourceReliability.view(task.id),
      }],
    };
  }
}

function mergeProviderChunks(chunks) {
  return {
    providers:chunks.flatMap(chunk=>chunk.provider ? [chunk.provider] : []),
    errors:chunks.flatMap(chunk=>chunk.errors || []),
    offers:chunks.flatMap(chunk=>chunk.offers || []),
  };
}

async function runProviderPass(providerQuery, pass = "primary", matchingQuery = providerQuery, options = {}) {
  const onChunk = typeof options.onChunk === "function" ? options.onChunk : null;
  const tasks = providerTasks(providerQuery, matchingQuery, options);
  if (!tasks.length) return {providers:[],errors:[],offers:[]};

  const rankedIds = sourceReliability.rank(tasks.map(task=>task.id));
  const rank = new Map(rankedIds.map((id,index)=>[id,index]));
  const ordered = [...tasks].sort((a,b)=>(rank.get(a.id)??999)-(rank.get(b.id)??999));
  const intent = parseSearchIntent(matchingQuery);
  const broad = intent.discoveryMode === "brand" || (!intent.model && !intent.storage && !intent.color && !intent.condition);
  const usefulThreshold = broad ? 20 : 8;
  const merchantThreshold = broad ? 2 : 1;

  const chunks=[];
  let relevant=[];
  const remaining=[...ordered];
  const inFlight=new Map();
  const launch=(task)=>{
    const p=executeProviderTask(task,pass,providerQuery).then(chunk=>({task,chunk}));
    inFlight.set(task.id,p);
  };
  // Providers already enforce their own deadlines. Start every eligible
  // provider immediately so a slow source never sits in front of a fast source.
  // This changes scheduling only: no provider or offer is removed.
  const initial=remaining.length;
  while(remaining.length) launch(remaining.shift());

  while(inFlight.size){
    const settled=await Promise.race(inFlight.values());
    inFlight.delete(settled.task.id);
    chunks.push(settled.chunk);
    if (onChunk) {
      try { await onChunk(settled.chunk, { completed:chunks.length, total:ordered.length, pending:remaining.length + inFlight.size }); } catch {}
    }

    relevant = dedupeNormalizedOffers(chunks.flatMap(chunk=>chunk.offers || []))
      .map(offer=>({...offer,...assessOfferMatch(matchingQuery,offer)}))
      .filter(offer=>(offer.matchConfidence || 0)>=0.65);
    const merchants=new Set(relevant.map(offerMerchantKey)).size;
    const enough=relevant.length>=usefulThreshold && merchants>=merchantThreshold;


  }

  const merged=mergeProviderChunks(chunks);
  return {
    ...merged,
    routing:{
      mode:"adaptive-progressive",
      ordered:ordered.map(task=>task.id),
      launched:chunks.map((chunk,index)=>chunk.provider?.sourceId || ordered[index]?.id).filter(Boolean),
      skipped:[],
      exhaustiveEligibleProviders:true,
      usefulCoverageReached:relevant.length>=usefulThreshold && new Set(relevant.map(offerMerchantKey)).size>=merchantThreshold,
      relevantOffers:relevant.length,
    },
  };
}

async function searchExpansion(query, depth) {
  query = normalizeSearchQuery(query);
  const plan = acquisitionPlan(depth, configuredFreeStorefronts().length);
  const providerQuery = parseSearchIntent(query).providerQuery;
  const amazonPromise = plan.amazonPageCount > 0
    ? searchFreeStorefrontById("amazon-sa", providerQuery, {
        perStore:Infinity,
        catalogLimit:Infinity,
        amazonPageStart:plan.amazonPageStart,
        amazonPageCount:plan.amazonPageCount,
        matchingQuery:query,
      }).catch(error=>({offers:[],error:error instanceof Error?error.message:String(error)}))
    : Promise.resolve({offers:[],diagnostics:null});
  const storefrontPromise = plan.storefrontLimit > 0
    ? searchFreeStorefronts(providerQuery, {
        matchingQuery:query,
        excludeStoreIds:["amazon-sa"],
        storeOffset:plan.storefrontOffset,
        storeLimit:plan.storefrontLimit,
        stableRouting:true,
        productPageLimit:plan.productPageLimit,
        catalogLimit:Infinity,
        storeDeadlineMs:6500,
      }).catch(error=>({provider:"free-storefronts",ok:false,searchedMarkets:[],offers:[],errors:[{error:error instanceof Error?error.message:String(error)}],diagnostics:[]}))
    : Promise.resolve({provider:"free-storefronts",ok:false,searchedMarkets:[],offers:[],errors:[],diagnostics:[]});

  const [amazon,storefront] = await Promise.all([amazonPromise,storefrontPromise]);
  const providers=[];
  const errors=[];
  if(plan.amazonPageCount>0) {
    providers.push({provider:"free-storefronts",sourceId:"free-storefronts:amazon-sa",ok:!amazon.error && Boolean(amazon.offers?.length),pass:"expansion",query:providerQuery,returnedOffers:amazon.offers?.length||0,diagnostics:amazon.diagnostics||null,searchedMarkets:[{id:"amazon-sa",countryCode:"SA"}]});
    if(amazon.error) errors.push({provider:"free-storefronts",sourceId:"free-storefronts:amazon-sa",pass:"expansion",error:amazon.error});
  }
  if(plan.storefrontLimit>0) {
    providers.push({provider:"free-storefronts",sourceId:"free-storefronts",ok:Boolean(storefront.ok),pass:"expansion",query:providerQuery,returnedOffers:storefront.offers?.length||0,diagnostics:storefront.diagnostics||null,searchedMarkets:storefront.searchedMarkets||[]});
    errors.push(...(storefront.errors||[]).map(error=>({provider:"free-storefronts",sourceId:"free-storefronts",pass:"expansion",...error})));
  }

  const offers=dedupeNormalizedOffers([...(amazon.offers||[]),...(storefront.offers||[])])
    .map(offer=>({...offer,...assessOfferMatch(query,offer),dataKind:offer.dataKind||"live"}))
    .filter(offer=>(offer.matchConfidence||0)>=0.65);
  const allSelectedOffers=selectDiverseOffers(offers,Infinity);
  const selectedOffers=allSelectedOffers.slice(0,plan.returnLimit);
  void Promise.allSettled([
    persistOffers(query,selectedOffers.filter(offer=>offer.dataKind==="live")),
    indexOffers(selectedOffers.filter(offer=>offer.dataKind==="live")),
  ]).catch(()=>{});
  const sources=currentSources();
  return {
    providersConfigured:configuredProviders(),
    coverage:{
      ...sourceCoverageSummary(sources),
      amazonDirectOffers:(amazon.offers||[]).length,
      returnedOffers:selectedOffers.length,
      availableOffers:allSelectedOffers.length,
      returnedMerchants:new Set(selectedOffers.map(offerMerchantKey)).size,
      truncated:selectedOffers.length<allSelectedOffers.length,
      exhaustive:false,
      acquisitionDepth:plan.depth,
      moreAvailable:plan.depth<MAX_SEARCH_DEPTH,
      incremental:true,
      acquisitionLimits:{
        amazonPageStart:plan.amazonPageStart,
        amazonPages:plan.amazonPageCount,
        storefrontOffset:plan.storefrontOffset,
        storefrontsPerPass:plan.storefrontLimit,
        productPagesPerStore:plan.productPageLimit,
        jarirCatalogResults:0,
        responseOffers:plan.returnLimit,
      },
      fallbackUsed:false,
    },
    providers,
    normalizedQuery:query,
    fallbackQuery:null,
    offers:selectedOffers,
    errors,
  };
}

function progressiveSnapshot(query, offers, providers, errors, progress = {}) {
  const assessed=dedupeNormalizedOffers(offers)
    .map(offer=>({...offer,...assessOfferMatch(query,offer),dataKind:offer.dataKind||"live"}))
    .filter(offer=>(offer.matchConfidence||0)>=0.65);
  const selected=selectDiverseOffers(assessed,Infinity).slice(0,acquisitionPlan(0,configuredFreeStorefronts().length).returnLimit);
  return {
    providersConfigured:configuredProviders(),
    normalizedQuery:query,
    offers:selected,
    providers,
    errors,
    coverage:{
      ...sourceCoverageSummary(currentSources()),
      returnedOffers:selected.length,
      availableOffers:assessed.length,
      returnedMerchants:new Set(selected.map(offerMerchantKey)).size,
      partial:true,
      complete:false,
      providersCompleted:progress.completed||0,
      providersPending:progress.pending||0,
    },
  };
}

async function streamSearchProgress(query, onSnapshot) {
  query=normalizeSearchQuery(query);
  const plan=acquisitionPlan(0,configuredFreeStorefronts().length);
  const providerQuery=parseSearchIntent(query).providerQuery;
  let offers=[],providers=[],errors=[];
  const emit=(progress={})=>onSnapshot(progressiveSnapshot(query,offers,providers,errors,progress));

  // Start durable catalog lookup and every live source immediately. Neither path
  // is allowed to block the other from producing the first useful result.
  const localPromise=Promise.all([
    searchIndexedOffers(query).catch(()=>({offers:[]})),
    searchPersistedOffers(query).catch(()=>({offers:[]})),
  ]).then(async local=>{
    offers.push(...(local[0].offers||[]),...(local[1].offers||[]));
    if(offers.length) await emit({completed:providers.length,pending:providerTasks(providerQuery,query,{plan}).length+1});
    return local;
  });

  const amazonPromise=searchFreeStorefrontById("amazon-sa",providerQuery,{
    perStore:Infinity,catalogLimit:Infinity,amazonPageStart:plan.amazonPageStart,
    amazonPageCount:plan.amazonPageCount,matchingQuery:query,
  }).then(value=>({value})).catch(error=>({error}));

  const primaryPromise=runProviderPass(providerQuery,"primary",query,{plan,onChunk:async(chunk,progress)=>{
    if(chunk.provider) providers.push(chunk.provider);
    errors.push(...(chunk.errors||[]));
    offers.push(...(chunk.offers||[]));
    await emit({...progress,pending:progress.pending+1});
  }});

  const amazonResult=await amazonPromise;
  if(amazonResult.value){
    const value=amazonResult.value;
    const sourceId="free-storefronts:amazon-sa";
    providers.push({provider:"free-storefronts",sourceId,ok:Boolean(value.offers?.length),pass:"primary",query:providerQuery,returnedOffers:value.offers?.length||0,diagnostics:value.diagnostics||null,searchedMarkets:[{id:"amazon-sa",countryCode:"SA"}]});
    offers.push(...(value.offers||[]));
    await emit({completed:providers.length,pending:1});
  } else {
    errors.push({provider:"free-storefronts",sourceId:"free-storefronts:amazon-sa",pass:"primary",error:amazonResult.error instanceof Error?amazonResult.error.message:String(amazonResult.error)});
  }
  await Promise.all([primaryPromise,localPromise]);

  // Reuse the work already completed by the progressive pass. Do not replay the
  // same providers a second time. Canonical search remains available to the JSON
  // endpoint and deeper cursor passes; the stream returns the accumulated recall
  // immediately and the UI can request deeper pages without losing any source.
  const assessed=dedupeNormalizedOffers(offers)
    .map(offer=>({...offer,...assessOfferMatch(query,offer),dataKind:offer.dataKind||"live"}))
    .filter(offer=>(offer.matchConfidence||0)>=0.65);
  const allSelectedOffers=selectDiverseOffers(assessed,Infinity);
  const selectedOffers=allSelectedOffers.slice(0,plan.returnLimit);
  void Promise.allSettled([
    persistOffers(query,selectedOffers.filter(offer=>offer.dataKind==="live")),
    indexOffers(selectedOffers.filter(offer=>offer.dataKind==="live")),
  ]).catch(()=>{});
  return {
    providersConfigured:configuredProviders(),
    coverage:{
      ...sourceCoverageSummary(currentSources()),
      returnedOffers:selectedOffers.length,
      availableOffers:allSelectedOffers.length,
      returnedMerchants:new Set(selectedOffers.map(offerMerchantKey)).size,
      truncated:selectedOffers.length<allSelectedOffers.length,
      exhaustive:false,
      acquisitionDepth:plan.depth,
      moreAvailable:plan.depth<MAX_SEARCH_DEPTH,
    },
    providers,
    normalizedQuery:query,
    fallbackQuery:null,
    offers:selectedOffers,
    errors,
  };
}

async function searchAll(query, { depth = 0 } = {}) {
  if (Number(depth) > 0) return searchExpansion(query, Number(depth));
  query = normalizeSearchQuery(query);
  const plan = acquisitionPlan(0, configuredFreeStorefronts().length);
  const providerQuery = parseSearchIntent(query).providerQuery;
  const configuredRequestDeadline = Number(process.env.SEARCH_REQUEST_DEADLINE_MS);
  const requestDeadlineMs = Number.isFinite(configuredRequestDeadline)
    ? Math.max(100, Math.min(25000, Math.floor(configuredRequestDeadline)))
    : 12000;
  const requestDeadlineAt = Date.now() + requestDeadlineMs;
  let deadlineExceeded = false;
  const beforeRequestDeadline = async (operation, fallback) => {
    const remaining = requestDeadlineAt - Date.now();
    if (remaining <= 0) {
      deadlineExceeded = true;
      return fallback();
    }
    const timeout = Symbol("search-request-deadline");
    let timeoutId;
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((resolve) => { timeoutId = setTimeout(() => resolve(timeout), remaining); }),
      ]);
      if (result !== timeout) return result;
      deadlineExceeded = true;
      return fallback();
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Local + GCC + global acquisition starts together. Amazon must never block
  // the rest of the world before other providers get a chance to answer.
  const amazonPromise = beforeRequestDeadline(
    () => searchFreeStorefrontById("amazon-sa", providerQuery, {
      perStore: Infinity,
      catalogLimit: Infinity,
      amazonPageStart: plan.amazonPageStart,
      amazonPageCount: plan.amazonPageCount,
      matchingQuery: query,
    }).catch((error) => ({ offers:[], error:error instanceof Error ? error.message : String(error) })),
    () => ({ offers:[], error:"search_deadline_exceeded" }),
  );
  const [amazon,primary,indexed,persisted] = await Promise.all([
    amazonPromise,
    beforeRequestDeadline(
      () => runProviderPass(providerQuery, "primary", query, { plan }),
      () => ({ providers:[], errors:[{provider:"search",sourceId:"search",pass:"primary",error:"search_deadline_exceeded"}], offers:[] }),
    ),
    beforeRequestDeadline(
      () => searchIndexedOffers(query).catch(() => ({ configured:false, offers:[] })),
      () => ({ configured:false, offers:[] }),
    ),
    beforeRequestDeadline(
      () => searchPersistedOffers(query).catch(() => ({ configured:false, offers:[] })),
      () => ({ configured:false, offers:[] }),
    ),
  ]);
  let providers = primary.providers;
  let errors = primary.errors;
  const amazonSourceId="free-storefronts:amazon-sa";
  providers.push({provider:"free-storefronts",sourceId:amazonSourceId,ok:!amazon.error && Boolean(amazon.offers?.length),pass:"primary",query:providerQuery,returnedOffers:amazon.offers?.length || 0,diagnostics:amazon.diagnostics || null,searchedMarkets:[{id:"amazon-sa",countryCode:"SA"}]});
  if(amazon.error) errors.push({provider:"free-storefronts",sourceId:amazonSourceId,pass:"primary",error:amazon.error});
  const amazonValidated = dedupeNormalizedOffers(amazon.offers || [])
    .map((offer) => ({
      ...offer,
      ...assessOfferMatch(query, offer),
      dataKind:"live",
    }))
    .filter((offer) => (offer.matchConfidence || 0) >= 0.65);
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
  // Never suppress global/local discovery merely because one marketplace
  // (usually Amazon) already returned many hits. More sources can still contain
  // the world's lowest price.
  const needsRecallExpansion =
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
      const expansions = await Promise.all(expansionQueries.map((candidate) => beforeRequestDeadline(
        () => runProviderPass(candidate, "fallback", query, { plan }),
        () => ({ providers:[], errors:[], offers:[] }),
      )));
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
      dataKind: offer.dataKind || "live",
    }))
    .filter((offer) => (offer.matchConfidence || 0) >= 0.65);
  // Amazon search cards are scored once against the shopper query above.
  // Merge those validated offers without scoring them a second time.
  offers = dedupeNormalizedOffers([...amazonValidated, ...rescoredOffers]);

  const sources = currentSources();
  const allSelectedOffers = selectDiverseOffers(offers, Infinity);
  const selectedOffers = allSelectedOffers.slice(0, plan.returnLimit);

  // Persistence/indexing are optional accelerators and must never delay the
  // shopper response. Write-through happens asynchronously after live results
  // are ready; failures are intentionally isolated from the search request.
  void Promise.allSettled([
    persistOffers(query, selectedOffers.filter(offer=>offer.dataKind === "live")),
    indexOffers(selectedOffers.filter(offer=>offer.dataKind === "live")),
  ]).catch(() => {});

  return {
    providersConfigured: configuredProviders(),
    coverage: {
      ...sourceCoverageSummary(sources),
      amazonDirectOffers: amazonValidated.length,
      returnedOffers: selectedOffers.length,
      availableOffers: allSelectedOffers.length,
      returnedMerchants: new Set(selectedOffers.map(offerMerchantKey)).size,
      truncated: selectedOffers.length < allSelectedOffers.length,
      exhaustive: false,
      acquisitionDepth: plan.depth,
      moreAvailable: plan.depth < MAX_SEARCH_DEPTH,
      acquisitionLimits: {
        amazonPageStart:plan.amazonPageStart,
        amazonPages:plan.amazonPageCount,
        storefrontOffset:plan.storefrontOffset,
        storefrontsPerPass:plan.storefrontLimit,
        productPagesPerStore:plan.productPageLimit,
        jarirCatalogResults:plan.jarirLimit,
        responseOffers:plan.returnLimit,
      },
      fallbackUsed: Boolean(fallbackQuery),
      deadlineExceeded,
      requestDeadlineMs,
    },
    providers,
    normalizedQuery: query,
    fallbackQuery,
    offers: selectedOffers,
    errors,
  };
}

const searchCacheKey = (query, depth) => JSON.stringify([query, depth]);
const cachedSearch = createSearchCache(async (key) => {
  const parsed = JSON.parse(key);
  if (!Array.isArray(parsed) || typeof parsed[0] !== "string") throw new Error("invalid_search_cache_key");
  return searchAll(parsed[0], { depth:Number(parsed[1]) || 0 });
}, { ttl:45000, maxEntries:48 });
const rateLimit = createRateLimiter();

function enforceRateLimit(req, res, scope, policy, origin = "*") {
  const key = requestClientKey(req) + ":" + scope;
  const verdict = rateLimit(key, policy);
  if (verdict.ok) return true;
  jsonResponse(res, 429, { error:"rate_limited", retryAfterMs:verdict.retryAfterMs }, origin || "*", {
    "retry-after": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))),
    "x-ratelimit-limit": String(verdict.limit),
    "x-ratelimit-remaining": "0",
  });
  return false;
}
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
  const actualHash=createHash("sha256").update(auth).digest();
  const expectedHash=createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(actualHash,expectedHash);
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
    if (req.headers.origin) return jsonResponse(res,403,{error:"origin_not_allowed"},origin || "*");
    if (!enforceRateLimit(req,res,"ingest",{capacity:20,refillPerSecond:0.2},origin || "*")) return;
    if (!ingestAuthorized(req)) return jsonResponse(res, 401, { error:"unauthorized" }, origin || "*");
    try {
      const body=await readJsonBody(req);
      const valid=normalizeIngestBatch(body.offers);
      if(!valid.length)return jsonResponse(res,422,{error:"no_valid_offers"},origin||"*");
      const source=String(body.source||"crawler").trim()||"crawler";
      const records=[];
      for(const offer of valid) records.push(await recordOffer({...offer,sourceName:source,query:source}));
      cachedSearch.clear();
      return jsonResponse(res,201,{accepted:valid.length,recorded:records.length},origin||"*");
    } catch(error) {
      const message=error instanceof Error?error.message:String(error);
      const status=error?.message==="payload_too_large"?413
        : error?.message==="persistence_not_configured"?503
        : error?.message==="invalid_offer_record"||error?.message==="invalid_observed_at"?422
        : 500;
      const publicMessage=status===500?"persistence_failed":message;
      return jsonResponse(res,status,{error:"ingest_failed",message:publicMessage},origin||"*");
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
      apiVersion: "0.6.0",
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
    if (process.env.NAWAA_ENABLE_PUBLIC_SOURCE_AUDIT !== "1") return jsonResponse(res,404,{error:"not_found"},origin || "*");
    if (!enforceRateLimit(req,res,"source-audit",{capacity:2,refillPerSecond:1/600},origin || "*")) return;
    const storeId = String(url.searchParams.get("store") || "").trim() || null;
    const query = String(url.searchParams.get("q") || "").trim() || null;
    try {
      const audit = await auditFreeStorefronts({ storeId, query });
      // Audits are live diagnostics and must never be served from intermediary caches.
      res.setHeader("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      res.setHeader("pragma", "no-cache");
      res.setHeader("expires", "0");
      res.setHeader("surrogate-control", "no-store");
      return jsonResponse(res, 200, audit, origin || "*");
    } catch (error) {
      return jsonResponse(res, 400, {
        error:"source_audit_failed",
        message:error instanceof Error ? error.message : String(error),
      }, origin || "*");
    }
  }

  if (req.method === "GET" && url.pathname === "/api/extract") {
    if (!enforceRateLimit(req,res,"url-resolution",{capacity:10,refillPerSecond:0.1},origin || "*")) return;
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
    if (!enforceRateLimit(req,res,"url-resolution",{capacity:10,refillPerSecond:0.1},origin || "*")) return;
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

  if (req.method === "GET" && url.pathname === "/api/search/stream") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (!enforceRateLimit(req,res,"search-stream",{capacity:20,refillPerSecond:0.35},origin || "*")) return;
    if (q.length < 2 || q.length > 180) return jsonResponse(res,400,{error:"invalid_query"},origin || "*");

    const normalized = normalizeSearchQuery(q);
    const key = searchCacheKey(normalized,0);
    const cached = cachedSearch.peek(key);
    res.writeHead(200,{
      "content-type":"text/event-stream; charset=utf-8",
      "cache-control":"no-cache, no-transform",
      "connection":"keep-alive",
      "access-control-allow-origin":origin || "*",
      "x-accel-buffering":"no",
      "x-content-type-options":"nosniff",
    });
    const send=(event,data)=>{
      if(res.writableEnded)return;
      res.write("event: "+event+"\n");
      res.write("data: "+JSON.stringify(data)+"\n\n");
    };
    send("meta",{query:q,normalizedQuery:normalized,observedAt:new Date().toISOString()});

    let closed=false;
    req.on("close",()=>{closed=true;});
    try {
      if (cached) {
        send("snapshot",cached);
        if (cached.cache?.mode === "fresh") {
          send("done",{cache:"fresh",offers:cached.offers?.length || 0});
          return res.end();
        }
      }

      const heartbeat=setInterval(()=>{ if(!closed&&!res.writableEnded) res.write(": keepalive\n\n"); },5000);
      let result;
      try {
        result=await streamSearchProgress(normalized,async(snapshot)=>{
          if(!closed&&!res.writableEnded) send("snapshot",{...snapshot,cache:{hit:false,mode:"progress",stale:false,refreshing:true,ageMs:0}});
        });
      } finally { clearInterval(heartbeat); }
      if (closed || res.writableEnded) return;
      send("snapshot",{...result,coverage:{...(result.coverage||{}),partial:false,complete:true,providersPending:0},cache:{hit:false,mode:"refresh",stale:false,refreshing:false,ageMs:0}});
      send("done",{cache:cached ? "revalidated" : "miss",offers:result.offers?.length || 0});
      return res.end();
    } catch(error) {
      if (!closed && !res.writableEnded) {
        send("error",{error:"search_failed",message:error instanceof Error?error.message:String(error)});
        res.end();
      }
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const q = String(url.searchParams.get("q") || "").trim();
    const productUrl = String(url.searchParams.get("url") || "").trim();
    const cursorToken = String(url.searchParams.get("cursor") || "").trim();
    if (!enforceRateLimit(req,res,"search",{capacity:30,refillPerSecond:0.5,cost:cursorToken?2:1},origin || "*")) return;
    if (productUrl ? productUrl.length > 2000 : q.length < 2 || q.length > 180) {
      return jsonResponse(res, 400, { error: "invalid_query" }, origin || "*");
    }

    try {
      const started = Date.now();
      const resolvedOffer = productUrl ? await resolveProductUrl(productUrl) : null;
      const comparisonQuery = resolvedOffer ? buildComparisonQuery(resolvedOffer) : q;
      if (comparisonQuery.length < 2) throw new Error("Product identity could not be extracted");
      const normalizedComparisonQuery = normalizeSearchQuery(comparisonQuery);
      let depth = 0;
      if (cursorToken) {
        try { depth = decodeSearchCursor(cursorToken, normalizedComparisonQuery).depth; }
        catch { return jsonResponse(res,400,{error:"invalid_search_cursor"},origin || "*"); }
      }
      const result = await cachedSearch(searchCacheKey(normalizedComparisonQuery, depth));
      if (resolvedOffer) result.offers = mergeComparisonOffers(resolvedOffer, result.offers);
      const nextCursor = depth < MAX_SEARCH_DEPTH ? encodeSearchCursor(normalizedComparisonQuery, depth + 1) : null;
      return jsonResponse(res, 200, {
        query: productUrl || q,
        comparisonQuery: resolvedOffer ? comparisonQuery : null,
        resolvedOffer,
        destinationCountry: "SA",
        observedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        nextCursor,
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

server.headersTimeout = 10000;
server.requestTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 100;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NAWAA search backend listening on :${PORT}`);
});
