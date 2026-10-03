import net from "node:net";
import { assessOfferMatch, normalizeSearchQuery, parseSearchIntent } from "../src/search-query.mjs";
import { toNawaaProduct } from "./nawaa-extractor.mjs";
import { compareProductIdentity } from "./product-identity.mjs";

const currencies = new Set(Intl.supportedValuesOf("currency"));
const costFields = ["shipping","importCost","tax","mandatoryFees","discount"];
const nonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

// Syntax gate only. Page verification still uses the resolver's DNS/redirect safety checks.
function productUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if(url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    if(net.isIP(host) || host === "localhost" || !host.includes(".") || /\.(?:local|internal|localhost)$/.test(host)) return false;
    if(url.pathname === "/" || /\/(?:search|catalogsearch|s|search-results)(?:\/|$)/i.test(url.pathname)) return false;
    return true;
  } catch { return false; }
}

export function validateAuditOffer(query, input) {
  const reasons=[],warnings=[];
  const offer = input && typeof input === "object" && !Array.isArray(input) ? {...input} : {};
  if(typeof offer.title !== "string" || !offer.title.trim()) reasons.push("missing_title");
  if(typeof offer.productPrice !== "number" || !Number.isFinite(offer.productPrice) || offer.productPrice <= 0 || !Number.isSafeInteger(Math.round(offer.productPrice*100))) reasons.push("invalid_price_sar");
  if(offer.currency !== "SAR") reasons.push("invalid_normalized_currency");
  if(!currencies.has(offer.originalCurrency)) reasons.push("invalid_original_currency");
  if(offer.originalCurrency === "SAR" && offer.originalProductPrice != null && (!nonnegative(offer.originalProductPrice) || !offer.originalProductPrice || Math.abs(offer.originalProductPrice-offer.productPrice)>0.011)) reasons.push("inconsistent_original_price");
  if(offer.originalCurrency !== "SAR" && currencies.has(offer.originalCurrency)) {
    const fx=offer.fx;
    if(!nonnegative(offer.originalProductPrice) || offer.originalProductPrice === 0 || !nonnegative(fx?.rate) || !fx.rate || !fx.source || !Number.isFinite(Date.parse(fx.observedAt)) || Math.abs(offer.originalProductPrice*fx.rate-offer.productPrice)>0.011) reasons.push("unverified_currency_conversion");
  }
  if(!productUrl(offer.sourceUrl)) reasons.push("invalid_product_url");
  if(typeof offer.merchant !== "string" || !offer.merchant.trim()) reasons.push("missing_merchant");
  if(!/^[A-Z]{2}$/.test(offer.merchantCountryCode || "")) reasons.push("missing_country");
  if(typeof offer.title === "string") {
    const match = assessOfferMatch(query,offer);
    const {model,storage:requestedStorage} = parseSearchIntent(query);
    const title = normalizeSearchQuery([offer.title,offer.specs?.deviceType].filter(Boolean).join(" "));
    const models=[offer.title,offer.specs?.deviceType,offer.specs?.series,offer.specs?.modelNumber].filter(Boolean).map(value=>parseSearchIntent(value).model).filter(Boolean);
    if(model && models.some(value=>value !== model)) reasons.push("model_conflict");
    // Explicit RAM quantities are not storage. Unlabeled conflicting capacities remain ambiguous.
    const storageText=normalizeSearchQuery([offer.title,offer.specs?.storage].filter(Boolean).join(" ")).replace(/\b\d+(?:gb|tb)\s+(?:ram|رام)\b|\b(?:ram|رام)\s+\d+(?:gb|tb)\b/g," ");
    const capacities=storageText.match(/\b\d+(?:gb|tb)\b/g) || [];
    if(requestedStorage && capacities.some(value=>value !== requestedStorage)) reasons.push("capacity_conflict");
    if(!match.exactMatch || (model && !(" "+title+" ").includes(" "+normalizeSearchQuery(model)+" "))) reasons.push("query_mismatch");
  }
  for(const field of costFields) {
    if(offer[field] != null && !nonnegative(offer[field])) reasons.push("invalid_cost:"+field);
  }
  if(!offer.image) warnings.push("missing_image");
  if(!offer.specs || !Object.keys(offer.specs).length) warnings.push("missing_specs");
  if(offer.availability === "out_of_stock") warnings.push("out_of_stock");
  else if(offer.availability !== "in_stock") warnings.push("unknown_availability");
  if(offer.canShipToSaudi !== true) warnings.push("unconfirmed_saudi_delivery");
  const known = costFields.every(field=>nonnegative(offer[field]));
  const total = known ? offer.productPrice + offer.shipping + offer.importCost + offer.tax + offer.mandatoryFees - offer.discount : null;
  if(known && (!Number.isFinite(total) || total <= 0 || !Number.isSafeInteger(Math.round(total*100)))) reasons.push("invalid_delivered_total");
  const complete = !reasons.length && known && offer.canShipToSaudi === true && offer.availability === "in_stock";
  if(!complete) warnings.push("incomplete_delivered_cost");
  const normalized = {...offer,title:typeof offer.title === "string" ? offer.title.trim() : "",image:offer.image || null,specs:offer.specs && typeof offer.specs === "object" ? offer.specs : {}};
  return {
    accepted:reasons.length === 0,reasons,warnings,
    product:toNawaaProduct(normalized,offer.sourceUrl || null),
    cost:{complete,totalSAR:complete ? Math.round(total*100)/100 : null},
  };
}

export function auditFailureCode(error) {
  const message = String(error?.message || error?.error || error || "");
  if(/timeout|timed out|abort/i.test(message) || /Timeout|Abort/.test(error?.name || "")) return "TIMEOUT";
  const status = message.match(/\b(4\d\d|5\d\d)\b/)?.[1];
  if(status) return "HTTP_"+status;
  if(/challenge|captcha|blocked|risk[- ]?control/i.test(message)) return "ACCESS_BLOCKED";
  return "UPSTREAM_ERROR";
}

function failureStatus(code) {
  return ["HTTP_403","HTTP_429","ACCESS_BLOCKED"].includes(code) ? "BLOCKED" : code === "TIMEOUT" ? "TIMEOUT" : "FETCH_FAILED";
}
function identity(offer) {
  return {title:offer.title,brand:offer.brand || offer.specs?.brand,sku:offer.sku,model:offer.specs?.modelNumber,gtin:offer.specs?.barcode};
}

function matchingPage(offer,resolved) {
  const same=compareProductIdentity(identity(offer),identity(resolved));
  const host=url=>new URL(url).hostname.toLowerCase().replace(/^www\./,"");
  if(host(offer.sourceUrl)!==host(resolved.sourceUrl) || same.conflicts.length) return false;
  const identifier=same.matches.some(value=>["sku","gtin","model"].includes(value));
  const exactTitle=normalizeSearchQuery(offer.title)===normalizeSearchQuery(resolved.title);
  return ["same","likely_same"].includes(same.verdict) && (identifier || exactTitle);
}

async function beforeDeadline(operation,deadline) {
  if(deadline === null) return operation();
  const remaining=deadline-Date.now();
  if(remaining<=0) throw new Error("Audit timeout");
  let timer;
  try {
    return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Audit timeout")),remaining);})]);
  } finally {clearTimeout(timer);}
}

// CLI/internal diagnostic contract; never added to the public customer API.
export async function auditSource({source,query,search,verifyPage=null,revision=null,expected="results",sampleLimit=3,timeoutMs=null}) {
  if(!["results","empty"].includes(expected)) throw new Error("Invalid expected outcome");
  if(typeof query !== "string" || query.trim().length < 2 || query.length > 180) throw new Error("Invalid audit query");
  if(!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 10) throw new Error("Invalid sample limit");
  if(timeoutMs !== null && (!Number.isInteger(timeoutMs) || timeoutMs<100 || timeoutMs>180000)) throw new Error("Invalid audit timeout");
  const started=Date.now();
  const deadline=timeoutMs === null ? null : started+timeoutMs;
  const report={schemaVersion:"nawaa.source-audit.v1",source:{id:source.id,name:source.name,adapter:source.adapter,status:source.status},query,expected,revision,observedAt:new Date().toISOString(),verifiedSource:false,counts:{raw:0,accepted:0,rejected:0,duplicates:0},samples:[],rejections:[],errorCodes:[]};
  const finish=status=>({...report,status,durationMs:Date.now()-started});
  if(source.status === "candidate") return finish("UNCONNECTED");
  if(source.status !== "configured") return finish("NOT_CONFIGURED");
  report.counts={raw:null,accepted:null,rejected:null,duplicates:null};
  let result;
  try {
    result=await beforeDeadline(()=>search(query),deadline);
    if(!Array.isArray(result?.offers)) throw new Error("Malformed provider response");
  } catch(error) {
    report.failureCode=auditFailureCode(error);
    report.failureStage="search";report.errorCodes.push(report.failureCode);
    return finish(failureStatus(report.failureCode));
  }
  const raw=result.offers;
  report.counts={raw:raw.length,accepted:0,rejected:0,duplicates:0};
  report.errorCodes=(Array.isArray(result.errors) ? result.errors : []).map(auditFailureCode);
  if(result.diagnostics?.primarySearchError) report.errorCodes.push(auditFailureCode(result.diagnostics.primarySearchError));
  if(result.failures > 0 && !report.errorCodes.length) report.errorCodes.push("PRODUCT_LOOKUP_FAILED");
  if(!raw.length) {
    if(report.errorCodes.length) {
      report.counts={raw:null,accepted:null,rejected:null,duplicates:null};
      report.failureStage="search";report.failureCode=report.errorCodes[0];return finish(failureStatus(report.failureCode));
    }
    return finish(expected === "empty" ? "NEGATIVE_CONTROL_PASS" : "NO_RESULTS");
  }
  const seen=new Set();const accepted=[];
  for(const offer of raw) {
    const check=validateAuditOffer(query,offer);
    const [provider,market]=String(source.adapter || "").split(":");
    if(offer?.provider !== provider || (market && offer?.providerMarket !== market) || (provider === "shopify" && "shopify:"+(offer?.providerMarket || offer?.merchant) !== source.id)) {
      check.accepted=false;check.reasons.push("source_mismatch");
    }
    if(!check.accepted) {
      report.counts.rejected++;
      if(report.rejections.length < sampleLimit) report.rejections.push({reasons:check.reasons,title:typeof offer?.title === "string" ? offer.title : null});
      continue;
    }
    // Same listing through different markets is one offer; different variant URLs remain independent.
    const key=offer.sourceListingId ? JSON.stringify([offer.provider,offer.sourceListingId]) : offer.sourceUrl;
    if(seen.has(key)) {report.counts.duplicates++;continue;}
    seen.add(key);accepted.push({offer,check});
  }
  report.counts.accepted=accepted.length;
  report.samples=accepted.slice(0,sampleLimit).map(({check})=>({product:check.product,cost:check.cost,warnings:check.warnings}));
  if(expected === "empty") return finish("NEGATIVE_CONTROL_FAIL");
  if(!accepted.length) return finish("INVALID_OFFERS");
  if(verifyPage) {
    const page={attempted:0,verified:0,failed:0};
    report.pageVerification=page;
    for(const {offer} of accepted.slice(0,sampleLimit)) {
      page.attempted++;
      try {
        const resolved=await beforeDeadline(()=>verifyPage(offer.sourceUrl),deadline);
        const validation=validateAuditOffer(query,resolved);
        if(!validation.accepted || !matchingPage(offer,resolved)) throw new Error("Product identity verification failed");
        if(resolved.originalCurrency !== offer.originalCurrency || (Number.isFinite(offer.originalProductPrice) && Number.isFinite(resolved.originalProductPrice) && Math.abs(offer.originalProductPrice-resolved.originalProductPrice) > 0.01)) throw new Error("Product price changed");
        if((!Number.isFinite(offer.originalProductPrice) || !Number.isFinite(resolved.originalProductPrice)) && Math.abs(offer.productPrice-resolved.productPrice)>0.01) throw new Error("Product price changed");
        page.verified++;
      } catch(error) {
        page.failed++;const code=auditFailureCode(error);report.errorCodes.push(code);
        if(code === "TIMEOUT") {report.failureCode=code;report.failureStage="page_verification";return finish("TIMEOUT");}
      }
    }
    report.pageVerification=page;
    if(page.failed) return finish("PAGE_VERIFICATION_FAILED");
  }
  if(report.counts.rejected || report.errorCodes.length) return finish("PARTIAL_SAMPLE");
  return finish(verifyPage ? "VERIFIED_SAMPLE" : "VALID_CATALOG_SAMPLE");
}
