import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAliExpressProductEvidence as decide,
  evaluateAliExpressBrowserDiagnostic as diagnostic,
} from "../src/aliexpress-product-evidence.mjs";

const ORIGINAL="1005012743543835";
const ALIAS="3256812557229083";
const NOW="2026-11-05T16:00:00.000Z";
const ITEM=id=>"https://ar.aliexpress.com/item/"+id+".html";
const baseline=()=>{
  const searchCard={
    productId:ORIGINAL,sourceUrl:ITEM(ORIGINAL),
    title:"Wireless Bluetooth Headphones",price:29.90,currency:"SAR",
    priceKind:"SEARCH_CARD_MINIMUM_VARIANT_UNVERIFIED",
    queryRelevanceEvidence:"TITLE_TOKEN_OVERLAP",
    customerPublishable:false,pdpPriceVerified:false,
  };
  const pdpEvidence={
    acquisition:{
      robotsState:"ALLOWED",httpStatus:200,challengeDetected:false,
      blockedNavigation:false,observedAt:NOW,
      requestedUrl:ITEM(ORIGINAL),finalUrl:ITEM(ORIGINAL),
    },
    documentItemId:ORIGINAL,canonicalUrl:ITEM(ORIGINAL),
    selectedVariant:{
      itemId:ORIGINAL,skuId:"SKU-XL-BLK",
      selectionSource:"FIRST_PARTY_SELECTED_VARIANT",
    },
    buybox:{
      itemId:ORIGINAL,skuId:"SKU-XL-BLK",price:"33.90",currency:"SAR",
      scope:"CURRENT_PRIMARY_BUYBOX",
      sourceType:"FIRST_PARTY_PDP_SELECTED_OFFER",observedAt:NOW,
    },
    variantPriceEvidence:{
      itemId:ORIGINAL,skuId:"SKU-XL-BLK",price:"33.90",currency:"SAR",
      sourceType:"MERCHANT_VARIANT_SPECIFIC_PRICE",observedAt:NOW,
    },
    stockState:"IN_STOCK",
  };
  return {searchCard,pdpEvidence};
};
const verdict=spec=>decide(spec,{now:NOW});
const clone=x=>structuredClone(x);
const unresolved=(spec,reason)=> {
  const result=verdict(spec);
  assert.equal(result.status,"UNVERIFIED",reason);
  assert.equal(result.reason,reason);
  assert.equal(result.eligibleForPublication,false);
  assert.equal(result.customerPublishable,false);
  assert.equal(result.pdpPriceVerified,false);
};
const contradicted=(spec,reason)=>{
  const result=verdict(spec);
  assert.equal(result.status,"CONFLICT",reason);
  assert.equal(result.reason,reason);
  assert.equal(result.eligibleForPublication,false);
  assert.equal(result.customerPublishable,false);
};

test("positive same-ID, selected SKU, current buybox and independent variant price",()=>{
  const d=verdict(baseline());
  assert.equal(d.status,"VERIFIED");
  assert.equal(d.reason,"SELECTED_VARIANT_PRICE_ATTESTED");
  assert.equal(d.eligibleForPublication,true);
  assert.equal(d.pdpPriceVerified,true);
  assert.equal(d.priceOriginal,33.90);
  assert.equal(d.currency,"SAR");
  assert.equal(d.variantSku,"SKU-XL-BLK");
  assert.equal(d.identityEvidenceClass,"SAME_ITEM_PDP");
  assert.equal(d.customerPublishable,false,"isolated resolver MUST NOT publish");
  assert.equal(d.shippingToSaudiVerified,false);
});

test("absent search or PDP cannot infer a price",()=>{
  unresolved({},"SEARCH_EVIDENCE_MISSING");
  unresolved({searchCard:baseline().searchCard},"PDP_EVIDENCE_MISSING");
});

test("cross-script merchant discovery cannot self-assert query relevance",()=>{
  const d=baseline();
  d.searchCard.queryRelevanceEvidence="MERCHANT_SEARCH_CROSS_SCRIPT_UNVERIFIED";
  unresolved(d,"QUERY_RELEVANCE_NOT_ATTESTED");
});

test("source search card must be original same-ID canonical merchant link",()=>{
  for(const link of [
    ITEM(ALIAS),
    "https://ar.aliexpress.com.evil.test/item/"+ORIGINAL+".html",
    "http://ar.aliexpress.com/item/"+ORIGINAL+".html",
    "https://user:pass@ar.aliexpress.com/item/"+ORIGINAL+".html",
    "https://ar.aliexpress.com:8080/item/"+ORIGINAL+".html",
    "https://ar.aliexpress.com/w/wholesale-headphones.html",
  ]){
    const d=baseline();d.searchCard.sourceUrl=link;
    contradicted(d,"SEARCH_ITEM_URL_IDENTITY_CONFLICT");
  }
});

test("minimum search price is not PDP selected-variant evidence",()=>{
  const d=baseline();
  d.pdpEvidence=null;
  unresolved(d,"PDP_EVIDENCE_MISSING");
  d.pdpEvidence=baseline().pdpEvidence;
  d.searchCard.priceKind="SHOPPER_VERIFIED";
  unresolved(d,"SEARCH_PRICE_NOT_ATTESTED");
  d.searchCard.priceKind="SEARCH_CARD_MINIMUM_VARIANT_UNVERIFIED";
  d.searchCard.price=0;
  unresolved(d,"SEARCH_PRICE_NOT_ATTESTED");
});

test("search card cannot self-promote as verified before PDP evidence",()=>{
  for(const key of ["customerPublishable","pdpPriceVerified"]){
    const d=baseline();d.searchCard[key]=true;
    contradicted(d,"SEARCH_CARD_PREMATURE_VERIFICATION");
  }
});

test("robots, HTTP, blocked document, challenge and stale report reject",()=>{
  const variants=[
    ["robotsState","UNKNOWN"],["robotsState","DISALLOWED"],
    ["httpStatus",403],["httpStatus",302],
    ["challengeDetected",true],["blockedNavigation",true],
    ["observedAt","2026-11-05T15:00:00Z"],
    ["observedAt","2026-11-06T15:00:00Z"],
  ];
  for(const [field,value] of variants){
    const d=baseline();d.pdpEvidence.acquisition[field]=value;
    unresolved(d,"PDP_ACQUISITION_NOT_ATTESTED");
  }
});

test("canonical/document conflicts reject source price despite valid buybox",()=>{
  for(const field of ["documentItemId","canonicalUrl"]){
    const d=baseline();
    d.pdpEvidence[field]=field==="documentItemId"?ALIAS:ITEM(ALIAS);
    contradicted(d,"PDP_DOCUMENT_IDENTITY_CONFLICT");
  }
});

test("a live official 302 into a different item is NOT product equivalence",()=>{
  const d=baseline();
  d.pdpEvidence.acquisition.finalUrl=
    "https://www.aliexpress.us/item/"+ALIAS+".html";
  d.pdpEvidence.canonicalUrl=d.pdpEvidence.acquisition.finalUrl;
  d.pdpEvidence.documentItemId=ALIAS;
  unresolved(d,"CROSS_ITEM_REDIRECT_IDENTITY_UNVERIFIED");
});

test("same requested item but final URL off official domain is conflict",()=>{
  const d=baseline();
  d.pdpEvidence.acquisition.finalUrl="https://attacker.test/item/"+ORIGINAL+".html";
  contradicted(d,"PDP_REQUESTED_OR_FINAL_URL_INVALID");
});

test("redirect alias with just official trace evidence is not sufficient",()=>{
  const d=baseline();
  d.pdpEvidence.acquisition.finalUrl="https://www.aliexpress.us/item/"+ALIAS+".html";
  d.pdpEvidence.canonicalUrl=d.pdpEvidence.acquisition.finalUrl;
  d.pdpEvidence.documentItemId=ALIAS;
  d.aliasEvidence={
    proofType:"OFFICIAL_HTTP_REDIRECT_ONLY",
    originItemId:ORIGINAL,destinationItemId:ALIAS,
    status:"SAME_PHYSICAL_PRODUCT_AND_VARIANT",
  };
  unresolved(d,"CROSS_ITEM_ALIAS_PROOF_INSUFFICIENT");
});

test("explicit first-party same-product alias map can resolve but not skip variant proof",()=>{
  const d=baseline();
  d.pdpEvidence.acquisition.finalUrl=
    "https://www.aliexpress.us/item/"+ALIAS+".html";
  d.pdpEvidence.canonicalUrl=d.pdpEvidence.acquisition.finalUrl;
  d.pdpEvidence.documentItemId=ALIAS;
  d.aliasEvidence={
    proofType:"MERCHANT_EXPLICIT_ITEM_ID_MAPPING",
    sourceRole:"FIRST_PARTY_MERCHANT_FEED",
    originItemId:ORIGINAL,destinationItemId:ALIAS,
    status:"SAME_PHYSICAL_PRODUCT_AND_VARIANT",
    observedAt:NOW,sourceItemUrl:ITEM(ORIGINAL),
  };
  unresolved(d,"SELECTED_VARIANT_NOT_ATTESTED");
  for(const record of [d.pdpEvidence.selectedVariant,
    d.pdpEvidence.buybox,d.pdpEvidence.variantPriceEvidence])
    record.itemId=ALIAS;
  const decision=verdict(d);
  assert.equal(decision.status,"VERIFIED");
  assert.equal(decision.identityEvidenceClass,"MERCHANT_EXPLICIT_ALIAS_MAP");
  assert.equal(decision.customerPublishable,false);
});

test("stale merchant alias proof and negative alias proof cannot verify item",()=>{
  const d=baseline();
  d.pdpEvidence.acquisition.finalUrl=
    "https://www.aliexpress.us/item/"+ALIAS+".html";
  d.pdpEvidence.canonicalUrl=d.pdpEvidence.acquisition.finalUrl;
  d.pdpEvidence.documentItemId=ALIAS;
  d.aliasEvidence={
    proofType:"MERCHANT_EXPLICIT_ITEM_ID_MAPPING",
    sourceRole:"FIRST_PARTY_MERCHANT_FEED",
    originItemId:ORIGINAL,destinationItemId:ALIAS,
    status:"SAME_PHYSICAL_PRODUCT_AND_VARIANT",
    observedAt:"2026-11-04T16:00:00Z",sourceItemUrl:ITEM(ORIGINAL),
  };
  unresolved(d,"CROSS_ITEM_ALIAS_PROOF_INSUFFICIENT");
  d.aliasEvidence.observedAt=NOW;
  d.aliasEvidence.status="DIFFERENT_PRODUCT";
  contradicted(d,"ALIAS_NOT_EQUIVALENT");
});

test("variant selection requires exact SKU binding, not just product title",()=>{
  for(const selected of [
    null,
    {itemId:ORIGINAL,skuId:"XL"},
    {itemId:ALIAS,skuId:"SKU-XL-BLK",selectionSource:"FIRST_PARTY_SELECTED_VARIANT"},
    {itemId:ORIGINAL,skuId:"",selectionSource:"FIRST_PARTY_SELECTED_VARIANT"},
    {itemId:ORIGINAL,skuId:"SKU-XL-BLK",selectionSource:"MINIMUM_PRICE_CARD"},
  ]){
    const d=baseline();d.pdpEvidence.selectedVariant=selected;
    unresolved(d,"SELECTED_VARIANT_NOT_ATTESTED");
  }
});

test("buybox must be exactly selected active product and variant",()=>{
  for(const [field,value] of [
    ["itemId",ALIAS],["skuId","SKU-SMALL"],["scope","RECOMMENDATION"],
    ["sourceType","SEARCH_CARD"],["price","0"],["currency","usd"],
    ["observedAt","2026-11-04T15:00:00Z"],
  ]){
    const d=baseline();d.pdpEvidence.buybox[field]=value;
    unresolved(d,"BUYBOX_SELECTED_SKU_PRICE_NOT_ATTESTED");
  }
});

test("second price must be independently selected SKU and fresh",()=>{
  for(const [field,value] of [
    ["itemId",ALIAS],["skuId","SKU-SMALL"],
    ["sourceType","PRODUCT_JSONLD_MIN_VARIANT"],["currency",null],
    ["price",null],["observedAt","2026-11-04T15:00:00Z"],
  ]){
    const d=baseline();d.pdpEvidence.variantPriceEvidence[field]=value;
    unresolved(d,"VARIANT_PRICE_CORROBORATION_MISSING");
  }
});

test("conflicting buybox price or currency cannot become a customer price",()=>{
  for(const [field,value] of [["price","44.00"],["currency","USD"]]){
    const d=baseline();d.pdpEvidence.variantPriceEvidence[field]=value;
    contradicted(d,"SELECTED_SKU_PRICE_CONFLICT");
  }
});

test("out-of-stock and unknown availability are not verified purchasable offers",()=>{
  const d=baseline();d.pdpEvidence.stockState="UNKNOWN";
  unresolved(d,"VARIANT_STOCK_UNATTESTED");
  d.pdpEvidence.stockState="OUT_OF_STOCK";
  contradicted(d,"VERIFIED_VARIANT_OUT_OF_STOCK");
});

test("price below PLP minimum may be valid variant-specific fresh price",()=>{
  const d=baseline();
  d.pdpEvidence.buybox.price="29.00";
  d.pdpEvidence.variantPriceEvidence.price="29.00";
  assert.equal(verdict(d).status,"VERIFIED");
});

test("browser live diagnostic cannot fabricate a product price",()=>{
  const result=diagnostic({
    requestedHost:"ar.aliexpress.com",requestedItemId:ORIGINAL,
    conclusion:"BROWSER_UNAPPROVED_DOCUMENT_REDIRECT_BLOCKED",
    domEvidence:{priceCandidate:{priceOriginal:"2.99",currency:"USD"}},
  },{now:NOW});
  assert.equal(result.status,"UNVERIFIED");
  assert.equal(result.eligibleForPublication,false);
  assert.equal(result.customerPublishable,false);
  assert.equal(result.reason,"BROWSER_UNAPPROVED_DOCUMENT_REDIRECT_BLOCKED");
});

test("cross-ID alias same source type cannot self-assert physical equivalence",()=>{
  const d=baseline();
  d.pdpEvidence.acquisition.finalUrl="https://www.aliexpress.us/item/"+ALIAS+".html";
  d.pdpEvidence.canonicalUrl=d.pdpEvidence.acquisition.finalUrl;
  d.pdpEvidence.documentItemId=ALIAS;
  d.aliasEvidence={
    proofType:"MERCHANT_EXPLICIT_ITEM_ID_MAPPING",
    sourceRole:"UNTRUSTED_BROWSER_REDIRECT",
    originItemId:ORIGINAL,destinationItemId:ALIAS,
    status:"SAME_PHYSICAL_PRODUCT_AND_VARIANT",
    observedAt:NOW,sourceItemUrl:ITEM(ORIGINAL),
  };
  unresolved(d,"CROSS_ITEM_ALIAS_PROOF_INSUFFICIENT");
});
