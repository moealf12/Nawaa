import net from "node:net";
import { queryMatchReasons } from "../src/search-query.mjs";
import { toNawaaProduct } from "./nawaa-extractor.mjs";
import { sameOfferIdentity } from "./product-identity.mjs";

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
    reasons.push(...queryMatchReasons(query,offer));
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
  if(/Requested product variant could not be verified/.test(message)) return "PAGE_VARIANT_UNVERIFIED";
  if(/Product page identity mismatch/.test(message)) return "PAGE_IDENTITY_MISMATCH";
  if(/Product page query mismatch/.test(message)) return "PAGE_QUERY_MISMATCH";
  if(/Product page currency mismatch/.test(message)) return "PAGE_CURRENCY_CHANGED";
  if(/Product page price invalid/.test(message)) return "PAGE_DATA_INVALID";
  const transportCode=error?.cause?.code || error?.code;
  if(["ENOTFOUND","EAI_AGAIN"].includes(transportCode)) return "DNS_LOOKUP_FAILED";
  if(["ECONNRESET","ECONNREFUSED","UND_ERR_SOCKET"].includes(transportCode)) return "CONNECTION_FAILED";
  if(/not an HTML product page/i.test(message)) return "PAGE_NOT_HTML";
  if(/Product page is too large/i.test(message)) return "PAGE_TOO_LARGE";
  if(/Private\/internal addresses|Only HTTPS|Non-standard ports|Invalid product URL/i.test(message)) return "UNSAFE_PAGE_URL";
  if(/Too many redirects|Redirect without location/i.test(message)) return "PAGE_REDIRECT_FAILED";
  return "UPSTREAM_ERROR";
}

function failureStatus(code) {
  return ["HTTP_403","HTTP_429","ACCESS_BLOCKED"].includes(code) ? "BLOCKED" : code === "TIMEOUT" ? "TIMEOUT" : "FETCH_FAILED";
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
  const queryFilter=result.diagnostics?.queryFilter;
  const pageRefresh=result.diagnostics?.pageRefresh;
  const validRefresh=source.adapter==='jarir-direct' && pageRefresh && [pageRefresh.attempted,pageRefresh.verified,pageRefresh.failed].every(n=>Number.isSafeInteger(n)&&n>=0) && pageRefresh.attempted===pageRefresh.verified+pageRefresh.failed && pageRefresh.verified===raw.length && pageRefresh.attempted===queryFilter?.retained && pageRefresh.failed===(Array.isArray(result.errors)?result.errors.filter(e=>e.market==='jarir-sa').length:0);
  if(validRefresh) report.providerPageRefresh={attempted:pageRefresh.attempted,verified:pageRefresh.verified,failed:pageRefresh.failed};
  if(queryFilter && [queryFilter.input,queryFilter.retained,queryFilter.removed].every(n=>Number.isSafeInteger(n) && n>=0) && (queryFilter.retained===raw.length || validRefresh) && queryFilter.input===queryFilter.retained+queryFilter.removed) {
    report.providerQueryFilter={input:queryFilter.input,retained:queryFilter.retained,removed:queryFilter.removed};
  }
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
    report.pageChecks=[];
    for(const {offer} of accepted.slice(0,sampleLimit)) {
      const detail={sampleIndex:page.attempted,status:"failed",code:null,reasons:[]};
      page.attempted++;
      try {
        const resolved=await beforeDeadline(()=>verifyPage(offer.sourceUrl),deadline);
        const validation=validateAuditOffer(query,resolved);
        if(!validation.accepted) {detail.code="PAGE_DATA_INVALID";detail.reasons=validation.reasons;}
        else if(!sameOfferIdentity(offer,resolved)) detail.code="PAGE_IDENTITY_MISMATCH";
        else if(resolved.originalCurrency !== offer.originalCurrency) detail.code="PAGE_CURRENCY_CHANGED";
        else if((Number.isFinite(offer.originalProductPrice) && Number.isFinite(resolved.originalProductPrice) && Math.abs(offer.originalProductPrice-resolved.originalProductPrice)>0.01) || ((!Number.isFinite(offer.originalProductPrice) || !Number.isFinite(resolved.originalProductPrice)) && Math.abs(offer.productPrice-resolved.productPrice)>0.01)) detail.code="PAGE_PRICE_CHANGED";
        else {page.verified++;detail.status="verified";}
        if(detail.code) {page.failed++;report.errorCodes.push(detail.code);}
      } catch(error) {
        page.failed++;const code=auditFailureCode(error);report.errorCodes.push(code);
        detail.code=code;
        report.pageChecks.push(detail);
        if(code === "TIMEOUT") {report.failureCode=code;report.failureStage="page_verification";return finish("TIMEOUT");}
        continue;
      }
      report.pageChecks.push(detail);
    }
    report.pageVerification=page;
    if(page.failed) {report.failureStage="page_verification";return finish("PAGE_VERIFICATION_FAILED");}
  }
  if(report.counts.rejected || report.errorCodes.length) return finish("PARTIAL_SAMPLE");
  return finish(verifyPage ? "VERIFIED_SAMPLE" : "VALID_CATALOG_SAMPLE");
}
