import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,createHash} from "node:crypto";
import {
  buildPartnerGrantSigningPayload,verifyPartnerGrantSignature,
} from "../server/merchant-grant-signature.mjs";
import {assessAuthorizedMerchantFeed} from "../server/merchant-feed-authorization-gate.mjs";

const NOW=Date.parse("2026-10-28T13:41:00Z");
const body=JSON.stringify({schemaVersion:1,sourceId:"decathlon-sa",country:"SA",currency:"SAR",
  observedAt:"2026-10-28T13:40:00Z",products:[{
    productUrl:"https://decathlon.com.sa/products/fixture",
    sku:"SKU-FIXTURE",variantId:"123456789",currency:"SAR",priceMinor:12300,available:null,
  }]});
const digest=createHash("sha256").update(body,"utf8").digest("hex");
const pair=generateKeyPairSync("ed25519");
const pub=pair.publicKey.export({type:"spki",format:"der"}).toString("base64");
function grant(extra={}){
  const raw={
    keyId:"test-only-signing-key-20261028",
    approvalId:"FIXTURE-APPROVAL-ONLY",
    sourceId:"decathlon-sa",
    verificationStatus:"INDEPENDENTLY_VERIFIED",
    feedTransport:"MERCHANT_SUPPLIED_FILE",
    evidenceReference:"TEST-PARTNER-LEGAL-REVIEW-NOT-REAL",
    permittedPurposes:["product_discovery","price_comparison"],
    country:"SA",merchantHost:"decathlon.com.sa",
    validFrom:"2026-10-28T12:00:00Z",
    validUntil:"2026-11-01T12:00:00Z",
    approvedPayloadSha256:digest,...extra,
  };
  const signature=sign(null,buildPartnerGrantSigningPayload(raw),pair.privateKey).toString("base64");
  return {...raw,signature};
}
function secured(testFn){
  const beforeKey=process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64;
  const beforeId=process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID;
  try{
    process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64=pub;
    process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID="test-only-signing-key-20261028";
    return testFn();
  }finally{
    if(beforeKey===undefined)delete process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64;
    else process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64=beforeKey;
    if(beforeId===undefined)delete process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID;
    else process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID=beforeId;
  }
}
const noOffers=r=>{
  assert.equal(r.publishedToSearch,false);
  assert.equal(r.trustedOffersCreated,0);
  assert.equal(r.stockVerified,false);
  assert.equal(r.shippingVerified,false);
  assert.equal(r.quoteAllowed,false);
};
test("RED: signed fixture receipt is cryptographically checked against server-pinned authority",()=>secured(()=>{
  const g=grant();
  assert.equal(verifyPartnerGrantSignature(g),true);
  const r=assessAuthorizedMerchantFeed({body,nowMs:NOW,trustedGrant:g});
  assert.equal(r.status,"FEED_ROWS_SCOPED_FOR_RESEARCH");
  assert.equal(r.authorizationVerified,true);
  noOffers(r);
}));
test("RED: unsigned string INDEPENDENTLY_VERIFIED cannot self-authorize",()=>secured(()=>{
  const g=grant();delete g.signature;
  assert.equal(verifyPartnerGrantSignature(g),false);
  const r=assessAuthorizedMerchantFeed({body,nowMs:NOW,trustedGrant:g});
  assert.equal(r.authorizationVerified,false);noOffers(r);
}));
test("RED: mutated countries, scopes, payload digest, expiration and key ID invalidate signed grant",()=>secured(()=>{
  for(const x of [
    {country:"GB"},
    {permittedPurposes:["product_discovery","price_comparison","content_reuse"]},
    {approvedPayloadSha256:"f".repeat(64)},
    {validUntil:"2026-11-02T12:00:00Z"},
    {validFrom:"2026-10-29T12:00:00Z"},
    {keyId:"someone-else"},
    {merchantHost:"decathlon.co.uk"},
  ]){
    const g={...grant(),...x};
    assert.equal(verifyPartnerGrantSignature(g),false);
    assert.equal(assessAuthorizedMerchantFeed({body,nowMs:NOW,trustedGrant:g}).authorizationVerified,false);
  }
}));
test("RED: independent attacker-signed self-approval cannot verify with pinned operator key",()=>secured(()=>{
  const attacker=generateKeyPairSync("ed25519"),g=grant();
  g.signature=sign(null,buildPartnerGrantSigningPayload(g),attacker.privateKey).toString("base64");
  assert.equal(verifyPartnerGrantSignature(g),false);
  noOffers(assessAuthorizedMerchantFeed({body,nowMs:NOW,trustedGrant:g}));
}));
test("RED: missing operator key, invalid public key and mismatched operator key ID fail closed",()=>{
  const before=process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64;
  const oldId=process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID;
  try{
    delete process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64;
    process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID="test-only-signing-key-20261028";
    const g=grant();
    assert.equal(verifyPartnerGrantSignature(g),false);
    assert.equal(assessAuthorizedMerchantFeed({body,nowMs:NOW,trustedGrant:g}).authorizationVerified,false);
    process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64="not-a-real-ed25519-key";
    assert.equal(verifyPartnerGrantSignature(g),false);
    process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64=pub;
    process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID="other-key";
    assert.equal(verifyPartnerGrantSignature(g),false);
  }finally{
    if(before===undefined)delete process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64;
    else process.env.NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64=before;
    if(oldId===undefined)delete process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID;
    else process.env.NAWAA_PARTNER_AUTHORITY_KEY_ID=oldId;
  }
});
test("RED: unknown receipt fields cannot be smuggled into an otherwise valid signature",()=>secured(()=>{
  const g={...grant(),overrideMerchantId:"evil.example"};
  assert.equal(verifyPartnerGrantSignature(g),false);
  noOffers(assessAuthorizedMerchantFeed({body,nowMs:NOW,trustedGrant:g}));
}));
