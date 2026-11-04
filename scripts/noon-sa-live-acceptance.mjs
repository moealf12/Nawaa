#!/usr/bin/env node
// Real Noon Saudi merchant request(s) only. No fixtures, replay, private API,
// proxy, evasion, retries or writes to customer/catalog state.
// Search-page prices are NEVER promoted to checkout/PDP-verified prices here.
import {writeFile} from "node:fs/promises";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {noonSaudiProductIdentity} from "../src/noon-sa-catalog.mjs";
import {classifySourceError} from "../src/source-access-intelligence.mjs";

const CASES = Object.freeze([
  {id:"smartphone", query:"iPhone 17 256GB"},
  {id:"computing", query:"laptop"},
  {id:"gaming", query:"PlayStation 5"},
  {id:"arabic-audio", query:"سماعات بلوتوث"},
]);
const REPORT_PATH = "noon-sa-live-acceptance.json";
const MAX_PER_SEARCH = 8;
const MAX_LATENCY_MS = 16000;
const isDenied = error => /(?:HTTP\s*(?:403|429)\b|ACCESS_DENIED|RATE_LIMIT|FORBIDDEN)/i.test(
  [error?.message,error?.failureClass,error?.code].filter(Boolean).join(" "));

function inspectOffer(offer) {
  const identity=noonSaudiProductIdentity(offer?.sourceUrl);
  const evidence=offer?.sourceMeta?.priceEvidence;
  const issues=[];
  if(!identity) issues.push("NON_NOON_SAUDI_PRODUCT_URL");
  if(!Number.isFinite(offer?.productPrice) || offer.productPrice<=0)
    issues.push("INVALID_PRICE");
  if(offer?.currency!=="SAR") issues.push("NON_SAR_PRICE");
  if(offer?.providerMarket!=="noon-sa") issues.push("WRONG_MARKET");
  if(offer?.specs?.modelNumber && identity &&
     offer.specs.modelNumber!==identity.sku) issues.push("SKU_MISMATCH");
  if(!["LIVE_HTML_SEARCH_CARD_ONLY","SEARCH_CARD_ONLY"].includes(evidence))
    issues.push("UNEXPECTED_PRICE_EVIDENCE");
  if(evidence==="LIVE_HTML_SEARCH_CARD_ONLY") {
    const url=new URL(offer.sourceUrl);
    if(url.searchParams.getAll("o").length!==1 || !url.searchParams.get("o"))
      issues.push("MISSING_EXACT_OFFER_CODE");
  }
  if(offer?.sourceMeta?.buyboxVerified===true ||
     offer?.sourceMeta?.deliveryVerified===true ||
     offer?.canShipToSaudi===true) issues.push("UNPROVEN_PURCHASE_CLAIM");
  return {
    productId:identity?.sku||null, priceEvidence:evidence||null,
    price:offer?.productPrice??null, currency:offer?.currency||null, issues,
  };
}

const report={
  schema:"nawaa.noon-sa.live-acceptance.v1",
  observedAt:new Date().toISOString(),
  githubSha:process.env.GITHUB_SHA||null,
  source:"noon-sa", transport:"public_first_party_search_html",
  requestLimit:CASES.length, perQueryLimit:MAX_PER_SEARCH,
  liveOnly:true, proxies:false, retries:0, customerPublished:false,
  pdpPriceVerified:false, checkoutVerified:false, saudiDeliveryVerified:false,
  cases:[], conclusion:"NOT_RUN",
};
let stopReason=null;
try {
  for(const spec of CASES) {
    const start=performance.now();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),MAX_LATENCY_MS);
    try {
      const response=await searchFreeStorefrontById("noon-sa",spec.query,{
        perStore:MAX_PER_SEARCH, signal:controller.signal,
        noonSearchCardDiagnostics:true,
      });
      const findings=(response.offers||[]).map(inspectOffer);
      const invalid=findings.filter(f=>f.issues.length>0);
      report.cases.push({
        id:spec.id,query:spec.query,
        state:invalid.length?"INTEGRITY_REJECTED":
          findings.length?"LIVE_SEARCH_PRICE_OBSERVED":"NO_VALID_SEARCH_PRICE",
        durationMs:Math.round(performance.now()-start),
        candidateCount:response.candidates||0,
        priceObservedCount:findings.length,
        independentPdpVerifiedCount:0,
        invalidCount:invalid.length,
        evidence:response.diagnostics?.noonSearchCards||null,
        sample:findings.slice(0,2),
      });
      if(invalid.length) {stopReason="INTEGRITY_REJECTED";break;}
    } catch(error) {
      const access=classifySourceError(error);
      stopReason=isDenied(error) || isDenied(access)?"ACCESS_DENIED":"SOURCE_REQUEST_FAILED";
      report.cases.push({
        id:spec.id,query:spec.query,state:stopReason,
        failureClass:access?.failureClass||null,
        durationMs:Math.round(performance.now()-start),
        candidateCount:0,priceObservedCount:0,
        independentPdpVerifiedCount:0,
        invalidCount:0,
      });
      // Never amplify a merchant access denial or repeated transport failure.
      break;
    } finally {
      clearTimeout(timer);
    }
  }
} finally {
  const observed=report.cases.filter(c=>c.state==="LIVE_SEARCH_PRICE_OBSERVED");
  report.totalPriceObserved=report.cases.reduce((s,c)=>s+(c.priceObservedCount||0),0);
  report.independentPdpVerifiedCount=0;
  report.completedCases=report.cases.length;
  report.stopReason=stopReason;
  report.conclusion=stopReason || (observed.length>=2
    ? "LIVE_SEARCH_ACQUISITION_PASSED_PDP_PARITY_PENDING"
    : "LIVE_COVERAGE_INSUFFICIENT");
  await writeFile(REPORT_PATH,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({
    conclusion:report.conclusion,completedCases:report.completedCases,
    searchPriceObserved:report.totalPriceObserved,
    pdpPriceVerified:0,customerPublished:false,
    cases:report.cases.map(({id,state,durationMs,candidateCount,priceObservedCount,
      invalidCount,failureClass})=>({id,state,durationMs,candidateCount,
      priceObservedCount,invalidCount,failureClass})),
  },null,2));
  if(report.conclusion!=="LIVE_SEARCH_ACQUISITION_PASSED_PDP_PARITY_PENDING")
    process.exitCode=1;
}
