import assert from "node:assert/strict";
import test from "node:test";
import {inspectAmazonDePdpHtml} from "../src/amazon-de-pdp-identity.mjs";
const url="https://www.amazon.de/dp/B0FQFW3423";
test("A live-observed generic Amazon DE HTML 200 cannot attest a requested ASIN",()=>{
  const report=inspectAmazonDePdpHtml("<html><head><title>Amazon.de</title></head></html>",url);
  assert.equal(report.status,"PDP_ASIN_NOT_OBSERVED");
  assert.equal(report.expectedAsin,"B0FQFW3423");
  assert.equal(report.priceVerified,false);
  assert.equal(report.requestedProductIdentityAttested,false);
});
test("Even an ASIN marker does not certify price or requested variant",()=>{
  const report=inspectAmazonDePdpHtml('<span data-asin="B0FQFW3423">Other products</span>',url);
  assert.equal(report.status,"ASIN_MARKER_PRESENT_UNATTESTED");
  assert.equal(report.priceVerified,false);
  assert.equal(report.requestedProductIdentityAttested,false);
});
test("Amazon DE URL guard refuses foreign hosts and malformed URLs",()=>{
  assert.equal(inspectAmazonDePdpHtml("", "https://www.amazon.de.evil.example/dp/B0FQFW3423"),null);
  assert.equal(inspectAmazonDePdpHtml("", "https://evil@www.amazon.de/dp/B0FQFW3423"),null);
  assert.equal(inspectAmazonDePdpHtml("", "http://www.amazon.de/dp/B0FQFW3423"),null);
  assert.equal(inspectAmazonDePdpHtml("", "https://www.amazon.de/s?k=watch"),null);
  assert.equal(inspectAmazonDePdpHtml("", "https://www.thomann.de/de/watch.htm"),null);
});
