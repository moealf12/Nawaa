import { persistOffers, recordOffer, searchPersistedOffers } from "./persistence.mjs";
import { createEbayDeletionHandler } from "./ebay-notifications.mjs";
import { sourceCoverageSummary } from "../src/source-registry.mjs";
import { configuredProviders, currentSources } from "./source-config.mjs";
import { selectDiverseOffers, offerMerchantKey } from "./offer-selection.mjs";
import {enforceCustomerOfferPublication} from "./customer-offer-output.mjs";
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
import { searchNoon } from "./providers/noon.mjs";
import {legacyNoonProviderActive} from "./noon-source-policy.mjs";
import { carrefourConfigured, searchCarrefour } from "./providers/carrefour.mjs";
import { searchSharafDG } from "./providers/sharafdg.mjs";
import { searchSwarovskiSaudi, swarovskiSaudiEligible } from "./providers/swarovski.mjs";
import { amazonCreatorsConfigured, configuredAmazonCreatorMarkets, searchAmazonCreators } from "./providers/amazon-creators.mjs";
import { configuredFreeStorefronts, searchFreeStorefronts, searchFreeStorefrontById } from "./providers/free-storefronts.mjs";
import { normalizeSearchQuery, parseSearchIntent, buildComparisonQuery, mergeComparisonOffers, buildProviderFallbackQueries } from "../src/search-query.mjs";
import { firstOfferMilestones } from "../src/search-first-offer-metrics.mjs";
import { summarizeSourceFailures } from "../src/search-coverage-status.mjs";
import { createSearchCache } from "./search-cache.mjs";
import { sourceReliability } from "./source-reliability.mjs";
import { auditFreeStorefronts } from "./source-audit.mjs";
import { createInternalAuditHandler } from "./internal-audit.mjs";
import { upsertPimProduct, pimConfigured } from "./pim-bridge.mjs";
import { normalizeIngestBatch } from "./ingestion.mjs";
import { indexOffers, searchIndexedOffers } from "./search-index.mjs";
import { createRateLimiter, requestClientKey } from "./rate-limit.mjs";
import { acquisitionPlan, decodeSearchCursor, encodeSearchCursor, MAX_SEARCH_DEPTH } from "./search-cursor.mjs";
import {quoteWorkflowEnabled, handleQuoteWorkflow} from "./quote-workflow.mjs";

const PORT = Number(process.env.PORT || 10000);
// Isolated canonical HTTP proof: synthetic canonical prices must not be mixed
// with independently acquired live merchant evidence in one assertion.
const OMEGA_INDEX_ONLY = process.env.NODE_ENV==='test' &&
  process.env.NAWAA_CANONICAL_INDEX_TEST==='1' &&
  process.env.NAWAA_OMEGA_INDEX_ONLY==='1';
const OMEGA_CANONICAL = process.env.NODE_ENV==='test' && process.env.NAWAA_CANONICAL_INDEX_TEST==='1';
async function canonicalCandidates(offers,acceptLive=false){
  if(!OMEGA_CANONICAL)return offers;
  return (await import('./omega-canonical-index.mjs')).canonicalReadBoundary(offers,{acceptLive});
}
async function canonicalResponse(result,query){
  // Always enforce read-side source holds, including cache/index snapshots,
  // before JSON/SSE emits any prices. Test-only canonical mode is no exception.
  result=enforceCustomerOfferPublication(result);
  if(!OMEGA_CANONICAL)return result;
  const offers=selectDiverseOffers(retainRelatedOffers(query,await canonicalCandidates(result.offers||[])),Infinity);
  return {...result,offers,coverage:{...result.coverage,returnedOffers:offers.length,
    availableOffers:offers.length,returnedMerchants:new Set(offers.map(offerMerchantKey)).size}};
}
// Diagnostic-only phase timing. Never log offer contents, URL paths or queries.
const PROFILE_SEARCH_STREAM = process.env.NAWAA_PROFILE_STREAM === "1";
const STATIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/search.html", "search.html"],
  ["/product.html", "product.html"],
  ["/quote-admin.html", "quote-admin.html"],
  ["/src/quote-admin.mjs", "src/quote-admin.mjs"],
  ["/config.js", "config.js"],
  ["/src/search-page.mjs", "src/search-page.mjs"],
  ["/src/product-card-presentation.mjs", "src/product-card-presentation.mjs"],
  ["/src/search-core.mjs", "src/search-core.mjs"],
  ["/src/search-query.mjs", "src/search-query.mjs"],
  ["/src/search-stream.mjs", "src/search-stream.mjs"],
  ["/src/search-coverage-status.mjs", "src/search-coverage-status.mjs"],
  ["/src/product-page.mjs", "src/product-page.mjs"],
  ["/src/source-registry.mjs", "src/source-registry.mjs"],
]);
const STATIC_ASSET_PREFIX = "/assets/";

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function serveStaticFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  // Hide the candidate administration UI outside disposable quote-test mode.
  if ((pathname === "/quote-admin.html" || pathname === "/src/quote-admin.mjs") &&
      !quoteWorkflowEnabled()) return false;
  let relative = STATIC_FILES.get(pathname);
  if (!relative && pathname.startsWith(STATIC_ASSET_PREFIX)) {
    const assetName = pathname.slice(STATIC_ASSET_PREFIX.length);
    if (/^[A-Za-z0-9._-]+$/.test(assetName)) relative = `assets/${assetName}`;
  }
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

function providerTasks(providerQuery, matchingQuery, { skipFreeStorefronts = false, plan = acquisitionPlan(0, configuredFreeStorefronts().length), onOffers } = {}) {
  const tasks = [];
  const add = (id, run, { explicit = false, deadlineMs = null } = {}) => {
    if (!sourceReliability.shouldSkip(id, { explicit })) tasks.push({ id, run, deadlineMs });
  };

  // Core search providers must always get a chance per user request. Reliability
  // still affects diagnostics/routing inside providers, but a temporary cooldown
  // must not collapse the whole public API into an instant empty response.
  add("extra-unbxd", (signal) => searchExtraUnbxd(providerQuery, 100, matchingQuery, {signal}), { explicit:true, deadlineMs:8000 });
  add("jarir-direct", (signal) => searchJarir(providerQuery, plan.jarirLimit, matchingQuery, {signal, onOffers}), { explicit:true, deadlineMs:8000 });
  // Virgin UAE is a certified core comparison source. Run it explicitly in the
  // first wave so Jarir cannot be the only merchant visible to the shopper.
  add("virgin-ae", (signal) => searchFreeStorefrontById("virgin-ae", providerQuery, {
    signal,
    matchingQuery,
    perStore:Infinity,
    catalogLimit:Infinity,
    productPageLimit:8,
    storeDeadlineMs:7000,
  }), { explicit:true, deadlineMs:8000 });
  add("sharafdg-algolia", (signal) => searchSharafDG(providerQuery, 32, {signal}), { explicit:true, deadlineMs:8000 });
  if (swarovskiSaudiEligible(providerQuery)) add("swarovski-direct", () => searchSwarovskiSaudi(providerQuery), { explicit:true });
  if (amazonCreatorsConfigured()) add("amazon-creators", () => searchAmazonCreators(providerQuery));
  if (!skipFreeStorefronts) {
    add("free-storefronts", (signal) => searchFreeStorefronts(providerQuery, {
      signal,
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
  if (legacyNoonProviderActive()) add("noon-catalog", () => searchNoon(providerQuery));
  if (ebayConfigured()) add("ebay", () => searchEbayWorldwide(providerQuery));
  if (shopifyConfigured()) add("shopify", () => searchConfiguredShopifyStores(providerQuery));
  return tasks;
}

async function executeProviderTask(task, pass, providerQuery, {signal} = {}) {
  const providerDeadlineMs = Number(process.env.SEARCH_PROVIDER_DEADLINE_MS || 4200);
  const deadlineMs = task.deadlineMs || providerDeadlineMs;
  const started = Date.now();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason || new Error("search_request_aborted"));
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, {once:true});
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(controller.signal.reason instanceof Error
      ? controller.signal.reason : new Error("provider_aborted:"+task.id));
    if(controller.signal.aborted) onAbort();
    else controller.signal.addEventListener("abort", onAbort, {once:true});
  });
  const timer = setTimeout(() => controller.abort(new Error("provider_deadline_exceeded:"+task.id)),deadlineMs);
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return task.run(controller.signal);
      }),
      aborted,
    ]);
    if(controller.signal.aborted) throw controller.signal.reason;
    sourceReliability.record(task.id, {
      transportOk:true,offers:value.offers?.length || 0,
      latencyMs:Date.now()-started,relevant:true,
    });
    return {
      provider:{
        provider:value.provider,sourceId:task.id,ok:value.ok,pass,
        query:providerQuery,reliability:sourceReliability.view(task.id),
        diagnostics:value.diagnostics || null,
        returnedOffers:value.offers?.length || 0,
        searchedMarkets:value.searchedMarkets || value.searchedStores || [],
      },
      offers:value.offers || [],
      errors:(value.errors || []).map(error=>({provider:value.provider,sourceId:task.id,pass,...error})),
    };
  } catch(error) {
    // A closed shopper request is not evidence that this merchant is broken.
    if(signal?.aborted) return {provider:null,offers:[],errors:[]};
    sourceReliability.record(task.id,{
      transportOk:false,offers:0,latencyMs:Date.now()-started,relevant:true,
    });
    return {
      provider:null,offers:[],
      errors:[{
        provider:task.id,sourceId:task.id,pass,
        error:error instanceof Error?error.message:String(error),
        reliability:sourceReliability.view(task.id),
      }],
    };
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort",onAbort);
    signal?.removeEventListener("abort",forwardAbort);
  }
}

function retainRelatedOffers(query, offers = []) {
  return dedupeNormalizedOffers(offers)
    .map(offer => ({ ...offer, ...assessOfferMatch(query, offer), dataKind:offer.dataKind || "live" }))
    // Keep strong matches first, but do not erase useful cross-merchant alternatives.
    // A 0.35 floor still rejects unrelated/category-mismatched noise because those
    // are heavily penalized by assessOfferMatch (0.2x / 0.12x).
    .filter(offer => (offer.matchConfidence || 0) >= 0.35)
    .sort((a,b) => (b.matchConfidence || 0) - (a.matchConfidence || 0));
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
  const trace = typeof options.onTrace === "function" ? options.onTrace : null;
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
    const p=executeProviderTask(task,pass,providerQuery,{signal:options.signal})
      .then(chunk=>({task,chunk,readyAt:trace ? performance.now() : 0}));
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
    const dispatchAt = trace ? performance.now() : 0;
    if(trace) trace({stage:"providerCompleted",sourceId:settled.task.id,
      offers:settled.chunk.offers?.length||0,queueMs:Math.max(0,dispatchAt-settled.readyAt)});
    chunks.push(settled.chunk);
    if (onChunk) {
      try { await onChunk(settled.chunk, { completed:chunks.length, total:ordered.length, pending:remaining.length + inFlight.size }); } catch {}
    }
    if(trace) trace({stage:"providerCallbackReturned",sourceId:settled.task.id,
      offers:settled.chunk.offers?.length||0,callbackMs:Math.max(0,performance.now()-dispatchAt)});
    relevant = retainRelatedOffers(matchingQuery, chunks.flatMap(chunk=>chunk.offers || []));
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

  const offers=retainRelatedOffers(query, await canonicalCandidates([...(amazon.offers||[]),...(storefront.offers||[])],true));
  const allSelectedOffers=selectDiverseOffers(offers,Infinity);
  const selectedOffers=allSelectedOffers.slice(0,plan.returnLimit);
  void indexOffers(selectedOffers.filter(offer=>offer.dataKind==="live")).catch(()=>{});
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
      sourceFailures:summarizeSourceFailures(errors),
    },
    providers,
    normalizedQuery:query,
    fallbackQuery:null,
    offers:selectedOffers,
    errors,
  };
}

function progressiveSnapshot(query, offers, providers, errors, progress = {}) {
  const started=PROFILE_SEARCH_STREAM ? performance.now() : 0;
  const assessed=retainRelatedOffers(query, offers);
  const afterMatching=PROFILE_SEARCH_STREAM ? performance.now() : 0;
  const selected=selectDiverseOffers(assessed,Infinity).slice(0,acquisitionPlan(0,configuredFreeStorefronts().length).returnLimit);
  const afterSelection=PROFILE_SEARCH_STREAM ? performance.now() : 0;
  const snapshot = {
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
      sourceFailures:summarizeSourceFailures(errors),
    },
  };
  if (PROFILE_SEARCH_STREAM) console.log("SEARCH_STREAM_PHASE "+JSON.stringify({
    stage:"progressiveSnapshot",inputOffers:offers.length,assessedOffers:assessed.length,
    selectedOffers:selected.length,providerCount:providers.length,
    matchingMs:afterMatching-started,selectionMs:afterSelection-afterMatching,
    coverageMs:performance.now()-afterSelection,
  }));
  return snapshot;
}

async function streamSearchProgress(query, onSnapshot, {signal} = {}) {
  const traceStarted = PROFILE_SEARCH_STREAM ? performance.now() : 0;
  const trace = data => {
    if (PROFILE_SEARCH_STREAM) console.log("SEARCH_SOURCE_TRACE "+JSON.stringify({
      elapsedMs:performance.now()-traceStarted,...data,
    }));
  };
  query=normalizeSearchQuery(query);
  const plan=acquisitionPlan(0,configuredFreeStorefronts().length);
  const providerQuery=parseSearchIntent(query).providerQuery;
  const configuredDeadline=Number(process.env.SEARCH_STREAM_DEADLINE_MS);
  const streamDeadlineMs=Number.isFinite(configuredDeadline) && configuredDeadline>0
    ? Math.max(150,Math.min(25000,Math.floor(configuredDeadline))) : 11000;
  const primaryCount=OMEGA_INDEX_ONLY?0:providerTasks(providerQuery,query,{plan}).length;
  const controller=new AbortController();
  const forwardAbort=()=>controller.abort(signal.reason || new Error("search_client_disconnected"));
  if(signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort",forwardAbort,{once:true});
  let offers=[],providers=[],errors=[];
  let accepting=true,primaryCompleted=0,amazonSettled=false,localSettled=false;
  let emissions=Promise.resolve();
  const emit=(progress={})=>{
    const captured=[...offers];
    emissions=emissions.then(async()=>{
      if(!accepting)return;
      const current=await canonicalCandidates(captured,true);
      if(accepting)await onSnapshot(progressiveSnapshot(query,current,providers,errors,progress));
    });
    return emissions;
  };

  // Launch the catalog, core providers, and Amazon concurrently. Slow sources
  // are never allowed to postpone stream completion indefinitely.
  const localPromise=searchIndexedOffers(query).catch(()=>({offers:[]})).then(async local=>{
    localSettled=true;
    if(!accepting)return;
    offers.push(...(local?.offers||[]));
    if(local?.offers?.length)await emit({completed:primaryCompleted,pending:Math.max(0,primaryCount-primaryCompleted)+Number(!amazonSettled)});
  });

  const amazonPromise=OMEGA_INDEX_ONLY ? Promise.resolve().then(()=>{ amazonSettled=true; }) : searchFreeStorefrontById("amazon-sa",providerQuery,{
    perStore:Infinity,catalogLimit:Infinity,amazonPageStart:plan.amazonPageStart,
    amazonPageCount:plan.amazonPageCount,matchingQuery:query,signal:controller.signal,
  }).then(async value=>{
    amazonSettled=true;
    if(!accepting)return;
    const sourceId="free-storefronts:amazon-sa";
    providers.push({provider:"free-storefronts",sourceId,ok:Boolean(value.offers?.length),pass:"primary",query:providerQuery,returnedOffers:value.offers?.length||0,diagnostics:value.diagnostics||null,searchedMarkets:[{id:"amazon-sa",countryCode:"SA"}]});
    offers.push(...(value.offers||[]));
    // Retain diagnostic failures returned as data, not just rejected fetches.
    for(const issue of Array.isArray(value.errors)?value.errors:[]){
      errors.push({
        provider:"free-storefronts",sourceId,pass:"primary",
        error:typeof issue==="string"?issue:String(issue?.error||issue?.message||"amazon_search_failed"),
      });
    }
    if(value.offers?.length)await emit({completed:primaryCompleted+1,pending:Math.max(0,primaryCount-primaryCompleted)});
  }).catch(error=>{
    amazonSettled=true;
    if(accepting)errors.push({provider:"free-storefronts",sourceId:"free-storefronts:amazon-sa",pass:"primary",error:error instanceof Error?error.message:String(error)});
  });

  const primaryPromise=OMEGA_INDEX_ONLY ? Promise.resolve() : runProviderPass(providerQuery,"primary",query,{plan,signal:controller.signal,onOffers:async readyOffers=>{
    if(!accepting || controller.signal.aborted)return;
    offers.push(...readyOffers);
    trace({stage:"jarirPageReady",sourceId:"jarir-direct",offers:readyOffers.length});
    // A ready page is not a completed provider. Retain pending/partial coverage
    // until its final result (including pagination errors) has settled.
    await emit({completed:primaryCompleted,pending:Math.max(0,primaryCount-primaryCompleted)+Number(!amazonSettled)});
    trace({stage:"jarirPagePublished",sourceId:"jarir-direct",offers:readyOffers.length});
  },onTrace:PROFILE_SEARCH_STREAM ? trace : null,onChunk:async(chunk,progress)=>{
    if(!accepting)return;
    primaryCompleted++;
    if(chunk.provider)providers.push(chunk.provider);
    errors.push(...(chunk.errors||[]));
    offers.push(...(chunk.offers||[]));
    await emit({...progress,pending:progress.pending+Number(!amazonSettled)});
  }}).catch(error=>{
    if(accepting)errors.push({provider:"search",sourceId:"search",pass:"primary",error:error instanceof Error?error.message:String(error)});
  });

  let timer;
  const finished=Promise.allSettled([localPromise,amazonPromise,primaryPromise]).then(()=>"complete");
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve("deadline"),streamDeadlineMs);});
  let onRequestAbort;
  const disconnected=new Promise(resolve=>{
    onRequestAbort=()=>resolve("disconnected");
    if(signal?.aborted) onRequestAbort();
    else signal?.addEventListener("abort",onRequestAbort,{once:true});
  });
  const outcome=await Promise.race([finished,deadline,disconnected]);
  clearTimeout(timer);
  // Freeze the result before aborting the remaining transport. Late fulfillment
  // cannot send more SSE data or corrupt the finalized offer list.
  accepting=false;
  const deadlineExceeded=outcome==="deadline";
  if(outcome!=="complete") controller.abort(new Error(
    deadlineExceeded?"search_stream_deadline_exceeded":"search_client_disconnected"));
  signal?.removeEventListener("abort",forwardAbort);
  signal?.removeEventListener("abort",onRequestAbort);
  const providersPending=deadlineExceeded
    ? Math.max(0,primaryCount-primaryCompleted)+Number(!amazonSettled)+Number(!localSettled)
    : 0;
  if(deadlineExceeded)errors.push({
    provider:"search",sourceId:"search",pass:"primary",
    error:"search_stream_deadline_exceeded",providersPending,
  });

  const assessed=retainRelatedOffers(query, await canonicalCandidates(offers,true));
  const allSelectedOffers=selectDiverseOffers(assessed,Infinity);
  const selectedOffers=allSelectedOffers.slice(0,plan.returnLimit);
  void indexOffers(selectedOffers.filter(offer=>offer.dataKind==="live")).catch(()=>{});
  return {
    providersConfigured:configuredProviders(),
    coverage:{
      ...sourceCoverageSummary(currentSources()),
      returnedOffers:selectedOffers.length,
      availableOffers:allSelectedOffers.length,
      returnedMerchants:new Set(selectedOffers.map(offerMerchantKey)).size,
      truncated:selectedOffers.length<allSelectedOffers.length,
      exhaustive:false,
      partial:deadlineExceeded || errors.length>0,
      complete:!deadlineExceeded && errors.length===0,
      deadlineExceeded,
      streamDeadlineMs,
      providersPending,
      sourceFailures:summarizeSourceFailures(errors),
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
  if(OMEGA_INDEX_ONLY){
    const indexed=await searchIndexedOffers(query);
    const related=retainRelatedOffers(query,indexed.offers||[]);
    const selected=selectDiverseOffers(related,Infinity);
    return {
      normalizedQuery:query,offers:selected,providers:[],errors:[],
      providersConfigured:configuredProviders(),
      coverage:{...sourceCoverageSummary(currentSources()),
        returnedOffers:selected.length,availableOffers:selected.length,
        returnedMerchants:new Set(selected.map(offerMerchantKey)).size,
        partial:true,complete:false,exhaustive:false,
        sourceFailures:summarizeSourceFailures([])}
    };
  }
  const plan = acquisitionPlan(0, configuredFreeStorefronts().length);
  const providerQuery = parseSearchIntent(query).providerQuery;
  const configuredRequestDeadline = Number(process.env.SEARCH_REQUEST_DEADLINE_MS);
  const requestDeadlineMs = Number.isFinite(configuredRequestDeadline)
    ? Math.max(100, Math.min(25000, Math.floor(configuredRequestDeadline)))
    : 12000;
  const requestDeadlineAt = Date.now() + requestDeadlineMs;
  // The JSON cache coalesces identical searches. Abort one shared refresh only
  // at its own deadline, never when a single subscribing client disconnects.
  const requestController=new AbortController();
  let deadlineExceeded = false;
  const beforeRequestDeadline = async (operation, fallback) => {
    const remaining = requestDeadlineAt - Date.now();
    if (remaining <= 0) {
      deadlineExceeded = true;
      if(!requestController.signal.aborted)
        requestController.abort(new Error("search_deadline_exceeded"));
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
      if(!requestController.signal.aborted)
        requestController.abort(new Error("search_deadline_exceeded"));
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
      signal:requestController.signal,
    }).catch((error) => ({ offers:[], error:error instanceof Error ? error.message : String(error) })),
    () => ({ offers:[], error:"search_deadline_exceeded" }),
  );
  // Preserve every already-completed provider result when the request deadline
  // expires. A slow merchant must never erase valid prices returned by a fast one.
  // This is the same incremental evidence path used by SSE, without sacrificing
  // the existing bounded deadline on the synchronous JSON endpoint.
  const completedPrimaryChunks = [];
  const [amazon,primary,indexed,persisted] = await Promise.all([
    amazonPromise,
    beforeRequestDeadline(
      () => runProviderPass(providerQuery, "primary", query, {
        plan, signal:requestController.signal,
        onChunk: (chunk) => { completedPrimaryChunks.push(chunk); },
      }),
      () => {
        const completed = mergeProviderChunks(completedPrimaryChunks);
        return {
          ...completed,
          errors:[...completed.errors,{
            provider:"search",sourceId:"search",pass:"primary",
            error:"search_deadline_exceeded",
          }],
        };
      },
    ),
    beforeRequestDeadline(
      () => searchIndexedOffers(query).catch(() => ({ configured:false, offers:[] })),
      () => ({ configured:false, offers:[] }),
    ),
    beforeRequestDeadline(
      () => Promise.resolve({ configured:false, offers:[] }),
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
        () => runProviderPass(candidate, "fallback", query, { plan,signal:requestController.signal }),
        () => ({ providers:[], errors:[], offers:[] }),
      )));
      for (const fallback of expansions) {
        providers = providers.concat(fallback.providers);
        errors = errors.concat(fallback.errors);
        offers = offers.concat(fallback.offers);
      }
    }
  }

  offers=await canonicalCandidates(offers,true);
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
  offers = OMEGA_CANONICAL ? retainRelatedOffers(query,offers) : dedupeNormalizedOffers([...amazonValidated, ...rescoredOffers]);

  const sources = currentSources();
  const allSelectedOffers = selectDiverseOffers(offers, Infinity);
  const selectedOffers = allSelectedOffers.slice(0, plan.returnLimit);

  // Persistence/indexing are optional accelerators and must never delay the
  // shopper response. Write-through happens asynchronously after live results
  // are ready; failures are intentionally isolated from the search request.
  void indexOffers(selectedOffers.filter(offer=>offer.dataKind === "live")).catch(() => {});

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
      partial:deadlineExceeded || errors.length>0,
      complete:!deadlineExceeded && errors.length===0,
      deadlineExceeded,
      requestDeadlineMs,
      sourceFailures:summarizeSourceFailures(errors),
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
      "access-control-allow-headers": "accept,content-type,authorization,idempotency-key",
      "access-control-max-age": "86400",
    });
    return res.end();
  }

  if (!origin && req.headers.origin) return jsonResponse(res, 403, { error: "origin_not_allowed" }, "null");

  let url;
  try {
    url = new URL(req.url || "/", "http://nawaa.local");
  } catch {
    return jsonResponse(res, 400, { error:"invalid_request_url" }, origin || "*");
  }

  // Strictly disposable-only quote implementation. No production DB access,
  // production schema change, deployment switch or unauthenticated admin path.
  if (url.pathname === "/api/quotes" ||
      /^\/api\/(?:quotes|quote-admin)\//.test(url.pathname)) {
    if (!quoteWorkflowEnabled())return jsonResponse(res,404,{error:"not_found"},origin||"*");
    if (!enforceRateLimit(req,res,"quote-workflow",
      {capacity:40,refillPerSecond:0.2},origin||"*"))return;
    return handleQuoteWorkflow(req,res,url,origin);
  }

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
        noon: legacyNoonProviderActive(),
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
    // Streamed searches must expose the same signed depth-1 cursor as /api/search.
    // Without it, the UI cannot request additional sources after an SSE result.
    const nextCursor = encodeSearchCursor(normalized, 1);
    // The SSE layer already streams fresh evidence; never publish stale
    // exact/stock/price claims as its initial customer snapshot.
    const cached = cachedSearch.peek(key,{allowStale:false});
    const requestStarted = PROFILE_SEARCH_STREAM ? performance.now() : 0;
    let firstValidPublished=false,firstExactPublished=false;
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
      const measuring=PROFILE_SEARCH_STREAM && event==="snapshot";
      res.write("event: "+event+"\n");
      const serializeStarted=measuring ? performance.now() : 0;
      const serialized=JSON.stringify(data);
      const serializedAt=measuring ? performance.now() : 0;
      res.write("data: "+serialized+"\n\n");
      if (measuring) {
        const milestone=firstOfferMilestones(data?.offers);
        // One per milestone per request, bounded diagnostic labels only.
        const safeSource=o=>String(o?.providerMarket||o?.provider||"unknown").slice(0,48)
          .replace(/[^a-zA-Z0-9_:-]/g,"");
        if(!firstValidPublished && milestone.firstValid){
          firstValidPublished=true;
          console.log("SEARCH_FIRST_OFFER_TIMING "+JSON.stringify({kind:"valid",
            serverPublishMs:performance.now()-requestStarted,
            sourceId:safeSource(milestone.firstValid)}));
        }
        if(!firstExactPublished && milestone.firstExact){
          firstExactPublished=true;
          console.log("SEARCH_FIRST_OFFER_TIMING "+JSON.stringify({kind:"exact",
            serverPublishMs:performance.now()-requestStarted,
            sourceId:safeSource(milestone.firstExact)}));
        }
      }
      if (measuring) console.log("SEARCH_STREAM_PHASE "+JSON.stringify({
        stage:"snapshotWrite",bytes:Buffer.byteLength(serialized),
        serializeMs:serializedAt-serializeStarted,socketEnqueueMs:performance.now()-serializedAt,
      }));
    };
    send("meta",{query:q,normalizedQuery:normalized,observedAt:new Date().toISOString()});

    let closed=false;
    const streamController=new AbortController();
    // IncomingMessage 'close' also fires on fully received GET requests; use
    // ServerResponse 'close' to detect genuine client disconnects instead.
    res.once("close",()=>{
      if(!res.writableEnded) {
        closed=true;
        streamController.abort(new Error("search_client_disconnected"));
      }
    });
    try {
      if (cached) {
        const safeCached=await canonicalResponse(cached,normalized);
        send("snapshot",{...safeCached,nextCursor});
        if (cached.cache?.mode === "fresh") {
          send("done",{cache:"fresh",offers:safeCached.offers?.length || 0});
          return res.end();
        }
      }

      const heartbeat=setInterval(()=>{ if(!closed&&!res.writableEnded) res.write(": keepalive\n\n"); },5000);
      let result;
      try {
        result=await streamSearchProgress(normalized,async(snapshot)=>{
          snapshot=await canonicalResponse(snapshot,normalized);
          if(!closed&&!res.writableEnded) send("snapshot",{...snapshot,nextCursor,cache:{hit:false,mode:"progress",stale:false,refreshing:true,ageMs:0}});
        },{signal:streamController.signal});
      } finally { clearInterval(heartbeat); }
      if (closed || res.writableEnded) return;
      result=await canonicalResponse(result,normalized);
      if(closed||res.writableEnded)return;
      send("snapshot",{...result,nextCursor,cache:{hit:false,mode:"refresh",stale:false,refreshing:false,ageMs:0}});
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
      // JSON can return only current evidence or a new bounded acquisition;
      // a failed refresh may not certify an expired in-stock cached price.
      let result = await cachedSearch(searchCacheKey(normalizedComparisonQuery, depth),{allowStale:false});
      if (resolvedOffer) result.offers = mergeComparisonOffers(resolvedOffer, result.offers);
      if(OMEGA_CANONICAL&&resolvedOffer)await canonicalCandidates([resolvedOffer],true);
      result=await canonicalResponse(result,normalizedComparisonQuery);
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
