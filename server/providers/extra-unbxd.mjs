const EXTRA_API_KEY = "21705619e273429e5767eea44ccb1ad5";
const EXTRA_SITE_KEY = "ss-unbxd-auk-extra-saudi-en-prod11541714990488";
const EXTRA_SEARCH_BASE = `https://search.unbxd.io/${EXTRA_API_KEY}/${EXTRA_SITE_KEY}/search`;

import { filterQueryOffers,normalizeSearchQuery } from "../../src/search-query.mjs";
import {approvedExtraPdp,warmExtraPythonPdp} from "../../src/python-extra-bridge.mjs";
import {enrichExtraOffersWithPython} from "../python-extra-enrichment.mjs";
import {normalizeExtraUrl} from "../extra-url-health.mjs";
// Worker is pre-imported only on the approved Render service with the explicit
// warm flag; client queries cannot activate it. Never blocks HTTP startup.
warmExtraPythonPdp();

// Verified against full Unbxd responses (3 queries, 6 paired rounds):
// only requested product attributes are returned; validated output offers,
// prices, variant specs, provenance, and ranking are identical. Keep the
// explicit [] opt-out for diagnostic full-payload comparisons.
export const EXTRA_PROJECTION_FIELDS = Object.freeze([
  "_root_",
  "uniqueId",
  "productId",
  "id",
  "code",
  "name",
  "productName",
  "title",
  "autosuggest",
  "autosuggest_unstemmed",
  "currentPrice",
  "sellingPrice",
  "specialPrice",
  "basicPriceValueDiscount",
  "priceValue",
  "price",
  "imageUrl",
  "image",
  "amplienceProductBaseUrl",
  "available",
  "homeDeliveryEnabled",
  "inStock",
  "featureEnBrandName",
  "brandEn",
  "featureEnSeriesName",
  "featureEnDeviceType",
  "featureEnColor",
  "featureEnMemoryInternal",
  "featureEnRAMSIZE",
  "featureEnProcessor",
  "featureEnProcessorCore",
  "featureEnScreenSizeInch",
  "featureEnNetwork",
  "featureEnOperatingSystem",
  "featureEnRearCamera",
  "featureEnBatterySizeMAH",
  "featureEnWaterproofYN",
  "modelNumber",
  "barCode",
  "nameAr",
  "collectFromStoreEnabled",
  "isOnlineOnly",
  "url",
  "productUrl",
  "productPageUrl",
  "pdpUrl"
]);

function firstFinite(...values) {
  for (const value of values) {
    if (value == null || typeof value === "boolean" || (typeof value === "string" && !value.trim())) continue;
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

// Merchant-supplied direct PDP only. Never synthesize slugs from product titles.
function sourceOwnedPdp(product,sku) {
  for (const key of ["url","productUrl","productPageUrl","pdpUrl"]) {
    const raw=product?.[key];
    if(typeof raw!=="string")continue;
    const normalized=normalizeExtraUrl(raw);
    if(normalized && approvedExtraPdp(normalized,sku))return normalized;
  }
  return null;
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
    specs: {
      brand: firstString(product?.featureEnBrandName, product?.brandEn),
      series: firstString(product?.featureEnSeriesName),
      deviceType: firstString(product?.featureEnDeviceType),
      color: firstString(product?.featureEnColor),
      storage: firstString(product?.featureEnMemoryInternal),
      ram: firstString(product?.featureEnRAMSIZE),
      processor: firstString(product?.featureEnProcessor, product?.featureEnProcessorCore),
      screenSize: firstString(product?.featureEnScreenSizeInch),
      network: firstString(product?.featureEnNetwork),
      operatingSystem: firstString(product?.featureEnOperatingSystem),
      rearCamera: firstString(product?.featureEnRearCamera),
      battery: firstString(product?.featureEnBatterySizeMAH),
      waterproof: firstString(product?.featureEnWaterproofYN),
      modelNumber: firstString(product?.modelNumber),
      barcode: firstString(product?.barCode),
    },
    sourceMeta: {
      productId: id,
      pdpUrl:sourceOwnedPdp(product,id),
      nameAr: firstString(product?.nameAr),
      color: firstString(product?.featureEnColor),
      storage: firstString(product?.featureEnMemoryInternal),
      jeddahInStock,
      homeDeliveryEnabled: homeDelivery,
      collectFromStoreEnabled: boolish(product?.collectFromStoreEnabled),
      onlineOnly: boolish(product?.isOnlineOnly),
    },
  };
}

export async function searchExtraUnbxd(query, limit = 12, matchingQuery = query, {signal, probeFields,pythonExtract} = {}) {
  const cap = limit === Infinity ? Infinity : Math.max(1, Number(limit) || 12);
  const fetchCap = cap === Infinity ? 100 : Math.min(100, cap);
  const url = new URL(EXTRA_SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("rows", String(fetchCap));
  url.searchParams.set("format", "json");
  // Reduce unused merchant payload by default without capping products or
  // changing ranking. An explicit [] preserves the full-response probe path.
  const requestedFields = probeFields === undefined ? EXTRA_PROJECTION_FIELDS : probeFields;
  if (Array.isArray(requestedFields) && requestedFields.length) url.searchParams.set("fields",requestedFields.join(","));
  const products = [], seen = new Set(), errors = [];
  const startedAt = Date.now();
  // Opt-in, low-cardinality diagnostic timings; no price or identity data logged.
  const timingEnabled = process.env.NAWAA_PROFILE_EXTRA === "1";
  const timings = timingEnabled ? {networkBodyMs:0,headersMs:0,bodyAndJsonMs:0,normalizeMs:0,filterMs:0,pages:0} : null;
  // Opt-in TEST-only diagnostic: Response.text() + JSON.parse lets us time body
  // consumption/UTF-8 decoding separately from parse CPU. Production retains
  // Response.json() unmodified. Prove parity with deterministic mock Responses.
  const splitJsonTiming = timingEnabled && process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON === "1";
  if (splitJsonTiming) Object.assign(timings,{bodyReadDecodeMs:0,jsonParseMs:0});
  const overallDeadlineMs = 7200;
  let start = 0, total = null, complete = false;
  while(products.length < fetchCap) {
    signal?.throwIfAborted();
    url.searchParams.set("start", String(start));
    try {
      const remainingMs = overallDeadlineMs - (Date.now() - startedAt);
      if (remainingMs <= 0) { errors.push({market:"extra-sa",error:"pagination_deadline_exceeded"}); break; }
      const transportStart = timingEnabled ? performance.now() : 0;
      const response = await fetch(url, {headers:{accept:"application/json"},signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(Math.min(3000, remainingMs))]) : AbortSignal.timeout(Math.min(3000, remainingMs))});
      const headersAt = timingEnabled ? performance.now() : 0;
      if(!response.ok) throw new Error("extra-unbxd: HTTP " + response.status);
      let data;
      if (splitJsonTiming) {
        const raw = await response.text();
        const readAt = performance.now();
        // Decoded UTF-8 byte count, NOT compressed HTTP wire bytes.
        timings.decodedBodyBytes = (timings.decodedBodyBytes || 0) + Buffer.byteLength(raw,"utf8");
        data = JSON.parse(raw);
        const parsedAt = performance.now();
        timings.bodyReadDecodeMs += readAt - headersAt;
        timings.jsonParseMs += parsedAt - readAt;
      } else {
        data = await response.json();
      }
      if (timings) {
        const bodyParsedAt = performance.now();
        timings.headersMs += headersAt - transportStart;
        // Undici Response.json() combines body consumption and JSON parsing.
        // Do not mislabel this as pure download or isolated JSON.parse CPU.
        timings.bodyAndJsonMs += bodyParsedAt - headersAt;
        timings.networkBodyMs += bodyParsedAt - transportStart;
        timings.pages++;
      }
      const page = data?.response?.products;
      if(!Array.isArray(page)) throw new Error("extra-unbxd: Malformed product response");
      const count = data.response.numberOfProducts;
      if(Number.isFinite(Number(count)) && count != null) total = Number(count);
      let added = 0;
      const normalizeStart = timingEnabled ? performance.now() : 0;
      for(const product of page) {
        const offer = normalizeProduct(product);
        if(!offer || seen.has(offer.sourceUrl)) continue;
        seen.add(offer.sourceUrl); products.push(offer); added++;
        if(products.length >= fetchCap) break;
      }
      if (timings) timings.normalizeMs += performance.now() - normalizeStart;
      start += page.length;
      // Live search requests at most one bounded UNBXD page. Return it immediately;
      // deeper recall belongs to cursor expansion, never the first interactive wave.
      if (start >= fetchCap) { complete = total !== null ? start >= total : page.length < fetchCap; break; }
      if(!page.length || (total !== null && start >= total)) {complete=true;break;}
      if(!added) {errors.push({market:"extra-sa",error:"pagination_no_progress"});break;}
      if(total===null && page.length < Number(url.searchParams.get("rows"))) {complete=true;break;}
      if(Date.now() - startedAt >= overallDeadlineMs) { errors.push({market:"extra-sa",error:"pagination_deadline_exceeded"}); break; }
    } catch(error) {
      if(signal?.aborted) throw signal.reason || error;
      if(!products.length) throw error;
      errors.push({market:"extra-sa",error:error.message}); break;
    }
  }
  const filterStart = timingEnabled ? performance.now() : 0;
  const {offers,queryFilter}=filterQueryOffers(matchingQuery,products);
  if (timings) {
    timings.filterMs = performance.now() - filterStart;
    console.log("EXTRA_PHASE_TIMING "+JSON.stringify({queryLength:String(query).length,offers:offers.length,products:products.length,...timings}));
  }
  // General mode applies to all queries/visitors, but only to source-owned
  // exact-SKU PDP URLs. A missing merchant URL keeps the UNBXD offer intact.
  // The original operator-selected SKU mode remains independently supported.
  const approvedSku=String(process.env.NAWAA_EXTRA_PYTHON_CANARY_SKU||"");
  const approvedUrl=String(process.env.NAWAA_EXTRA_PYTHON_CANARY_URL||"");
  const canaryQuery=String(process.env.NAWAA_EXTRA_PYTHON_CANARY_QUERY||"");
  const baseEnabled=process.env.NAWAA_EXTRA_PYTHON_PDP==="1";
  const generalEnabled=baseEnabled&&process.env.NAWAA_EXTRA_PYTHON_ALL==="1";
  const canaryEnabled=baseEnabled &&
    canaryQuery.length>=5&&canaryQuery.length<=128 &&
    normalizeSearchQuery(canaryQuery)===normalizeSearchQuery(matchingQuery) &&
    approvedExtraPdp(approvedUrl,approvedSku);
  const pythonEnabled=generalEnabled||canaryEnabled;
  let finalOffers=offers,pythonDiagnostics=null;
  if(pythonEnabled&&offers.length&&!signal?.aborted){
    // Stay inside the provider's original 7200 ms acquisition budget.
    const remaining=overallDeadlineMs-(Date.now()-startedAt);
    if(remaining>=1000){
      const observed=await enrichExtraOffersWithPython(offers,matchingQuery,{
        approvedSku,approvedUrl,signal,timeoutMs:Math.min(generalEnabled?5500:3000,remaining),
        scope:generalEnabled?"all":"canary",maxAttempts:generalEnabled?2:1,
        extract:pythonExtract
      });
      finalOffers=observed.offers;
      pythonDiagnostics=observed.diagnostics;
    }else{
      pythonDiagnostics={attempted:0,accepted:0,rejected:0,failed:0,
        failureClasses:["PYTHON_EXTRA_BUDGET_EXHAUSTED"]};
    }
    // Never log source prices, visitor identities, page HTML or source bodies.
    console.info("NAWAA_EXTRA_PYTHON_CANARY "+JSON.stringify({
      sourceId:"extra-sa",mode:generalEnabled?"all":"canary",
      attempted:pythonDiagnostics.attempted,
      accepted:pythonDiagnostics.accepted,
      rejected:pythonDiagnostics.rejected,
      failed:pythonDiagnostics.failed,
      failureClasses:pythonDiagnostics.failureClasses
    }));
  }
  return {provider:"extra-unbxd",ok:finalOffers.length>0,
    searchedMarkets:[{id:"extra-sa",countryCode:"SA",countryNameAr:"السعودية"}],
    offers:finalOffers,errors,
    diagnostics:{queryFilter,pagination:{fetched:start,total,complete},
      ...(pythonDiagnostics?{pythonExtraPdp:pythonDiagnostics}:{})}};
}
