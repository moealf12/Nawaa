import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {buildPartnerGrantSigningPayload} from "../server/merchant-grant-signature.mjs";
import {
  PARTNER_SOURCE_ACCESS,assessAuthorizedMerchantFeed,
} from "../server/merchant-feed-authorization-gate.mjs";

// Ephemeral in-memory test authority only. No real partner grant is installed.
const pair=generateKeyPairSync("ed25519");
process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64=
  pair.publicKey.export({type:"spki",format:"der"}).toString("base64");
process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID="fixture-authority-v1";
const nowMs=Date.parse("2026-10-28T01:00:00Z");
const sampleRow=()=>({
  productUrl:"https://decathlon.com.sa/products/merchant-approved-test-item",
  sku:"TEST-SKU-123",variantId:"123456789",
  priceMinor:19900,currency:"SAR",available:true,
});
const data=()=>({schemaVersion:1,sourceId:"decathlon-sa",country:"SA",
  currency:"SAR",observedAt:"2026-10-28T00:59:00Z",
  products:[sampleRow()]});
const feed=dataObject=>JSON.stringify(dataObject);
const digest=body=>createHash("sha256").update(body,"utf8").digest("hex");
function fixture(input=data()){
  const body=feed(input);
  const unsigned={
    keyId:"fixture-authority-v1",
    approvalId:"FIXTURE-ONLY-NOT-REAL",
    sourceId:"decathlon-sa",verificationStatus:"INDEPENDENTLY_VERIFIED",
    feedTransport:"MERCHANT_SUPPLIED_FILE",
    evidenceReference:"FIXTURE_ONLY_APPROVAL_NOT_REAL",
    permittedPurposes:["product_discovery","price_comparison"],
    country:"SA",merchantHost:"decathlon.com.sa",
    validFrom:"2026-10-27T00:00:00Z",
    validUntil:"2026-11-01T00:00:00Z",
    approvedPayloadSha256:digest(body),
  };
  const signature=sign(null,buildPartnerGrantSigningPayload(unsigned),pair.privateKey).toString("base64");
  return {body,grant:{...unsigned,signature}};
}
const run=(f,overrides={})=>assessAuthorizedMerchantFeed({
  trustedGrant:f.grant,body:f.body,nowMs,...overrides,
});
function noPromotion(x){
  for(const k of ["stockVerified","shippingVerified","checkoutVerified",
    "sourceCurrentPriceGuaranteed","publishedToSearch","customerVisible","quoteAllowed"])
    assert.equal(x[k],false,k);
  assert.equal(x.trustedOffersCreated,0);
  for(const secret of ["TEST-SKU-123","123456789","19900","merchant-approved-test-item","FIXTURE_ONLY_APPROVAL_NOT_REAL"])
    assert.equal(JSON.stringify(x).includes(secret),false);
}
test("default Saudi registry remains pending; merchant UK affiliate evidence is not SA approval",()=>{
  assert.equal(PARTNER_SOURCE_ACCESS["decathlon-sa"].feedEnabled,false);
  assert.equal(PARTNER_SOURCE_ACCESS["decathlon-sa"].dataFeedPermission,"UNVERIFIED");
  assert.equal(PARTNER_SOURCE_ACCESS["decathlon-sa"].operatorVerifiedGrantInstalled,false);
  const r=assessAuthorizedMerchantFeed({body:fixture().body,nowMs});
  assert.equal(r.status,"MERCHANT_AUTHORIZATION_REQUIRED");
  assert.equal(r.feedIntegrityVerified,false);
  noPromotion(r);
});
test("trusted digest-bound approved fixture validates structured Saudi SKU/variant price data only",()=>{
  const x=run(fixture());
  assert.equal(x.status,"FEED_ROWS_SCOPED_FOR_RESEARCH");
  assert.equal(x.authorizationVerified,true);
  assert.equal(x.feedIntegrityVerified,true);
  assert.equal(x.feedProductsAccepted,1);
  assert.equal(x.sourcePriceCurrencyVerified,true);
  assert.equal(x.selectedVariantIdentityValid,true);
  noPromotion(x);
});
test("self-claimed approval inside feed never substitutes for independently supplied grant",()=>{
  const f=fixture({...data(),verificationStatus:"INDEPENDENTLY_VERIFIED",grant:fixture().grant});
  const x=run(f,{trustedGrant:null});
  assert.equal(x.status,"MERCHANT_AUTHORIZATION_REQUIRED");noPromotion(x);
});
test("merchant grant with foreign country, wrong scopes or expired term is refused",()=>{
  const f=fixture();
  for(const partial of [
    {country:"GB"},{merchantHost:"decathlon.co.uk"},
    {permittedPurposes:["product_discovery"]},
    {verificationStatus:"PENDING"},
    {feedTransport:"PUBLIC_AJAX_GET"},
  ]){
    const x=run(f,{trustedGrant:{...f.grant,...partial}});
    assert.equal(x.status,"MERCHANT_AUTHORIZATION_REQUIRED");noPromotion(x);
  }
  const expired=run(f,{trustedGrant:{...f.grant,validUntil:"2026-10-27T00:00:00Z"}});
  assert.equal(expired.status,"MERCHANT_AUTHORIZATION_EXPIRED");noPromotion(expired);
});
test("tampered feed payload or wrong approved SHA fails before parsing any row",()=>{
  const f=fixture();
  const altered=f.body.replace("19900","19901");
  const a=run({...f,body:altered});
  assert.equal(a.status,"FEED_INTEGRITY_NOT_VERIFIED");
  assert.equal(a.feedProductsAccepted,0);noPromotion(a);
  const b=run(f,{trustedGrant:{...f.grant,approvedPayloadSha256:"0".repeat(64)}});
  assert.equal(b.status,"MERCHANT_SIGNED_GRANT_REQUIRED");noPromotion(b);
});
test("foreign product URLs, cross-currency and duplicate variant cannot become valid rows",()=>{
  const input=data();
  input.products=[
    {...sampleRow(),productUrl:"https://evil.example/products/merchant-approved-test-item"},
    {...sampleRow(),currency:"USD"},
    sampleRow(),
    sampleRow(),
  ];
  const x=run(fixture(input));
  assert.equal(x.feedProductsAccepted,1);
  assert.equal(x.feedProductsRejected,3);noPromotion(x);
});
test("fake Ajax currency, invalid price, missing SKU and non-boolean stock are rejected",()=>{
  const input=data();
  input.products=[
    {...sampleRow(),priceMinor:12.5},
    {...sampleRow(),priceMinor:0},
    {...sampleRow(),sku:""},
    {...sampleRow(),variantId:"not-an-id"},
    {...sampleRow(),available:"in_stock"},
  ];
  const x=run(fixture(input));
  assert.equal(x.feedProductsAccepted,0);
  assert.equal(x.feedProductsRejected,5);
  assert.equal(x.sourcePriceCurrencyVerified,false);noPromotion(x);
});
test("stale or future feed snapshot is not treated as a current source observation",()=>{
  for(const observedAt of ["2026-10-27T00:59:00Z","2026-10-28T01:01:00Z"]){
    const f=fixture({...data(),observedAt});
    const x=run(f);
    assert.equal(x.status,"FEED_STRUCTURE_OR_FRESHNESS_INVALID");noPromotion(x);
  }
});
test("no payload, invalid JSON and huge document are refused",()=>{
  const f=fixture();
  for(const body of ["", "{broken", "x".repeat(512_100)]){
    const x=run({...f,body});
    assert.equal(x.feedIntegrityVerified,false);noPromotion(x);
  }
});
test("delivery, checkout and binding quote remain unknown even with true available flag",()=>{
  const x=run(fixture());
  assert.equal(x.sourcePriceCurrencyVerified,true);
  assert.equal(x.stockVerified,false);
  assert.equal(x.shippingVerified,false);
  assert.equal(x.checkoutVerified,false);
  assert.equal(x.quoteAllowed,false);noPromotion(x);
});
