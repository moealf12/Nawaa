import test from "node:test";
import assert from "node:assert/strict";
import {auditDecathlonSaudiPartnerReadiness} from "../scripts/audit-decathlon-partner-readiness.mjs";

test("actual Decathlon Saudi partner readiness remains OFF with zero network and zero customer data",()=>{
  const report=auditDecathlonSaudiPartnerReadiness();
  assert.equal(report.sourceId,"decathlon-sa");
  assert.equal(report.region,"SA");
  assert.equal(report.officialSaudiGrantStatus,"UNVERIFIED");
  assert.equal(report.merchantFeedEnabled,false);
  assert.equal(report.operatorVerifiedGrantInstalled,false);
  assert.equal(report.authorizationGate,"MERCHANT_AUTHORIZATION_REQUIRED");
  assert.equal(report.networkRequests,0);
  assert.equal(report.sourceFeedBytesImported,0);
  assert.equal(report.inventoryVerified,false);
  assert.equal(report.shippingVerified,false);
  assert.equal(report.bindingQuoteEligible,false);
  assert.equal(report.customerOfferPromotionEnabled,false);
  assert.equal(report.trustedOffersCreated,0);
  assert.equal(JSON.stringify(report).includes("merchant-approved-test-item"),false);
});
