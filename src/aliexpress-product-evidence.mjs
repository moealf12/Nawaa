/**
 * NAWAA R04-P4: strict AliExpress product/variant/price evidence resolver.
 *
 * PURE CONTRACT — no networking, no customer-facing writes, no trust assigned
 * to a redirect, PLP minimum, generic meta price, unrelated SKU, or seller.
 * Admission requires independently acquired, first-party variant-specific
 * PDP buybox AND a separately scoped corroborating selected-variant price.
 *
 * The caller is responsible for gathering authentic first-party evidence.
 * This resolver does NOT authenticate arbitrary caller-supplied JSON; hence
 * an isolated passing verdict is not permission to enable production.
 */

const ITEM_ID=/^\d{10,20}$/;
const SKU_ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CCY=/^[A-Z]{3}$/;
const DECIMAL=/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
const OFFICIAL_HOSTS=new Set([
  "www.aliexpress.com","ar.aliexpress.com","m.aliexpress.com",
  "aliexpress.com","www.aliexpress.us","aliexpress.us",
]);

function itemUrl(raw) {
  try {
    const u=new URL(raw);
    if (u.protocol!=="https:" || u.username || u.password ||
        (u.port && u.port!=="443") || !OFFICIAL_HOSTS.has(u.hostname.toLowerCase()))
      return null;
    const m=/^\/item\/(\d{10,20})\.html\/?$/i.exec(u.pathname);
    if(!m)return null;
    return {id:m[1], canonical:u.origin+"/item/"+m[1]+".html"};
  }catch{return null;}
}

function price(raw){
  if ((typeof raw!=="number"&&typeof raw!=="string") || !DECIMAL.test(String(raw)))
    return null;
  const n=Number(raw);
  return Number.isFinite(n)&&n>0&&n<10_000_000 ? Math.round(n*100) : null;
}
function validCurrency(v){return typeof v==="string"&&CCY.test(v)}
function validSku(v){return typeof v==="string"&&SKU_ID.test(v)}
function validFreshTime(ts,now,maxAgeMs=10*60_000) {
  const t=Date.parse(ts),n=Date.parse(now);
  return typeof ts==="string" && Number.isFinite(t)&&Number.isFinite(n)&&
    t<=n+30_000 && n-t<=maxAgeMs;
}

const result=(status,reason,fields={})=>({
  schema:"nawaa.aliexpress.product-evidence.v1",
  status,reason,eligibleForPublication:status==="VERIFIED",
  customerPublishable:false, // still requires production rollout/gating
  pdpPriceVerified:status==="VERIFIED",
  ...fields,
});

export function evaluateAliExpressProductEvidence(
  {searchCard,pdpEvidence,aliasEvidence=null}={},
  {now=new Date().toISOString()}={}
){
  const base={originalItemId:null,finalItemId:null,variantSku:null};
  if(!searchCard||typeof searchCard!=="object")
    return result("UNVERIFIED","SEARCH_EVIDENCE_MISSING",base);
  const searchId=String(searchCard.productId??"");
  const searchUrl=itemUrl(searchCard.sourceUrl);
  base.originalItemId=ITEM_ID.test(searchId)?searchId:null;
  if(!base.originalItemId||!searchUrl||searchUrl.id!==searchId)
    return result("CONFLICT","SEARCH_ITEM_URL_IDENTITY_CONFLICT",base);
  if(searchCard.customerPublishable===true||searchCard.pdpPriceVerified===true)
    return result("CONFLICT","SEARCH_CARD_PREMATURE_VERIFICATION",base);
  if(searchCard.priceKind!=="SEARCH_CARD_MINIMUM_VARIANT_UNVERIFIED" ||
     price(searchCard.price??searchCard.priceOriginal)===null ||
     !validCurrency(searchCard.currency))
    return result("UNVERIFIED","SEARCH_PRICE_NOT_ATTESTED",base);

  if(!pdpEvidence||typeof pdpEvidence!=="object")
    return result("UNVERIFIED","PDP_EVIDENCE_MISSING",base);
  const acquisition=pdpEvidence.acquisition;
  if(!acquisition||acquisition.robotsState!=="ALLOWED"||
     acquisition.httpStatus!==200||acquisition.challengeDetected!==false||
     acquisition.blockedNavigation===true||
     !validFreshTime(acquisition.observedAt,now))
    return result("UNVERIFIED","PDP_ACQUISITION_NOT_ATTESTED",base);
  const requested=itemUrl(acquisition.requestedUrl);
  const final=itemUrl(acquisition.finalUrl);
  if(!requested||!final||requested.id!==searchId)
    return result("CONFLICT","PDP_REQUESTED_OR_FINAL_URL_INVALID",base);
  base.finalItemId=final.id;
  if(pdpEvidence.documentItemId!==final.id||
     itemUrl(pdpEvidence.canonicalUrl)?.id!==final.id)
    return result("CONFLICT","PDP_DOCUMENT_IDENTITY_CONFLICT",base);

  if(searchId!==final.id) {
    if(!aliasEvidence)
      return result("UNVERIFIED","CROSS_ITEM_REDIRECT_IDENTITY_UNVERIFIED",base);
    if(aliasEvidence.proofType!=="MERCHANT_EXPLICIT_ITEM_ID_MAPPING"||
       aliasEvidence.sourceRole!=="FIRST_PARTY_MERCHANT_FEED"||
       aliasEvidence.originItemId!==searchId ||
       aliasEvidence.destinationItemId!==final.id ||
       !validFreshTime(aliasEvidence.observedAt,now) ||
       !itemUrl(aliasEvidence.sourceItemUrl) ||
       itemUrl(aliasEvidence.sourceItemUrl).id!==searchId)
      return result("UNVERIFIED","CROSS_ITEM_ALIAS_PROOF_INSUFFICIENT",base);
    if(aliasEvidence.status!=="SAME_PHYSICAL_PRODUCT_AND_VARIANT")
      return result("CONFLICT","ALIAS_NOT_EQUIVALENT",base);
  } else if (aliasEvidence && aliasEvidence.status==="DIFFERENT_PRODUCT") {
    return result("CONFLICT","ALIAS_CONTRADICTS_SAME_ITEM",base);
  }
  const selected=pdpEvidence.selectedVariant;
  const buybox=pdpEvidence.buybox;
  const independent=pdpEvidence.variantPriceEvidence;
  if(!selected||!validSku(selected.skuId)||selected.itemId!==final.id||
     selected.selectionSource!=="FIRST_PARTY_SELECTED_VARIANT")
    return result("UNVERIFIED","SELECTED_VARIANT_NOT_ATTESTED",base);
  base.variantSku=selected.skuId;
  if(!buybox||buybox.itemId!==final.id||buybox.skuId!==selected.skuId||
     buybox.scope!=="CURRENT_PRIMARY_BUYBOX"||
     buybox.sourceType!=="FIRST_PARTY_PDP_SELECTED_OFFER"||
     !validCurrency(buybox.currency)||price(buybox.price)===null||
     !validFreshTime(buybox.observedAt,now))
    return result("UNVERIFIED","BUYBOX_SELECTED_SKU_PRICE_NOT_ATTESTED",base);
  if(!independent||independent.itemId!==final.id||
     independent.skuId!==selected.skuId||
     independent.sourceType!=="MERCHANT_VARIANT_SPECIFIC_PRICE"||
     !validFreshTime(independent.observedAt,now)||
     !validCurrency(independent.currency)||price(independent.price)===null)
    return result("UNVERIFIED","VARIANT_PRICE_CORROBORATION_MISSING",base);
  if(buybox.currency!==independent.currency||
     price(buybox.price)!==price(independent.price))
    return result("CONFLICT","SELECTED_SKU_PRICE_CONFLICT",base);
  if(pdpEvidence.stockState==="OUT_OF_STOCK")
    return result("CONFLICT","VERIFIED_VARIANT_OUT_OF_STOCK",base);
  if(pdpEvidence.stockState!=="IN_STOCK")
    return result("UNVERIFIED","VARIANT_STOCK_UNATTESTED",base);
  // Search PLP price is a minimum *variant* amount, not buybox evidence.
  // Different amounts are not an assertion of product mismatch.
  return result("VERIFIED","SELECTED_VARIANT_PRICE_ATTESTED",{
    ...base,
    priceOriginal:Number((price(buybox.price)/100).toFixed(2)),
    currency:buybox.currency,
    shippingToSaudiVerified:false,
    shippingCost:null,
    identityEvidenceClass:searchId===final.id?
      "SAME_ITEM_PDP":"MERCHANT_EXPLICIT_ALIAS_MAP",
    evidenceRecordedAt:acquisition.observedAt,
  });
}

/** Bridge existing diagnostic script outputs to the strict evidence gate.
 * No existing browser or alias trace result has a selected buybox proof.
 */
export function evaluateAliExpressBrowserDiagnostic(browserReport) {
  // No browser diagnostic alone proves a source search-card price, selected
  // SKU, live buybox, or independent corroboration. Never synthesize any
  // missing input to reach VERIFIED.
  const original=String(browserReport?.requestedItemId??"");
  const final=String(browserReport?.domEvidence?.finalItemId||
    browserReport?.rendering?.finalItemId||"");
  const reason=typeof browserReport?.conclusion==="string" &&
    /^[A-Z0-9_]{3,90}$/.test(browserReport.conclusion) ?
      browserReport.conclusion : "BROWSER_DIAGNOSTIC_WITHOUT_SOURCE_PROOF";
  return result("UNVERIFIED",reason,{
    originalItemId:ITEM_ID.test(original)?original:null,
    finalItemId:ITEM_ID.test(final)?final:null,
    variantSku:null,
  });
}
