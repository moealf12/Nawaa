// One read-only Amazon.de search from GitHub CI + up to one same-host PDP.
// This reports whether source evidence is obtainable; it NEVER approves prices.
import assert from "node:assert/strict";
import { searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";
import { normalizeAmazonDeProductUrl } from "../server/amazon-de-bulk-url-health.mjs";
import { probeAmazonDeOffer } from "../server/amazon-de-offer-evidence.mjs";

const report = {
  sourceId: "amazon-de", environment: "CI_READ_ONLY",
  customerPublishable: false,
  writesToProduction: false, requestsByShoppers: false,
  search: null, pdp: null,
};
try {
  const found = await searchFreeStorefrontById("amazon-de", "iphone 17", { perStore: 2 });
  const policy = found?.diagnostics?.customerPublicationGate;
  assert.equal(policy?.customerPublishable, false, "AMAZON_DE_PUBLICATION_GATE_BYPASSED");
  assert.equal(found.offers?.length, 0, "AMAZON_DE_PRICED_OFFERS_MUST_STAY_HELD");
  const candidates = found?.diagnostics?.candidateSamples ?? [];
  report.search = {
    status: found.diagnostics?.sourceObservation || "UNKNOWN",
    candidateCount: found.candidates ?? 0,
    gate: policy.status,
    classification: found.diagnostics?.amazonDeAcquisition?.classification || null,
  };
  for (const raw of candidates.slice(0, 5)) {
    let asin = null;
    try {
      const path = new URL(raw).pathname;
      asin = /^\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i.exec(path)?.[1]?.toUpperCase() || null;
    } catch {}
    if (!asin || !normalizeAmazonDeProductUrl(raw, asin)) continue;
    const evidence = await probeAmazonDeOffer({asin,url:raw,timeoutMs:6000});
    report.pdp = { status: evidence.status, samePageParityObserved: evidence.samePageParityObserved,
      buyboxIndependentlyAttested: evidence.buyboxIndependentlyAttested };
    assert.equal(evidence.customerPublishable, false);
    break;
  }
  report.outcome = report.pdp ? "PDP_DIAGNOSTIC_COMPLETE" : "NO_SAFE_PDP_CANDIDATE_OBSERVED";
} catch (error) {
  // Only hard-fail on actual publication guard regression. Source 403, empty
  // catalog and challenges are honest diagnostics, never fabricated yield.
  if (/AMAZON_DE_.*(?:BYPASSED|MUST_STAY_HELD)/.test(String(error?.message || ""))) throw error;
  report.outcome = "ACQUISITION_UNAVAILABLE";
  report.failureClass = error?.name === "TimeoutError" ? "TIMEOUT" : "SOURCE_FETCH_OR_PARSE_FAILURE";
}
console.log("NAWAA_AMAZON_DE_CI_EVIDENCE " + JSON.stringify(report));
