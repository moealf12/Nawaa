// General Amazon.de live search diagnosis with configurable shopper-like queries.
// CI examples exercise diverse categories; runtime adapter accepts ANY query.
// This produces no offers, seller/price values, customer badges, or DB writes.
import { searchAmazonDeUniversal } from "../server/providers/amazon-de-universal.mjs";

const defaultQueries = [
  "iPhone 17", "PlayStation 5", "سماعات بلوتوث",
  "robot vacuum", "running shoes",
];
const queries = process.argv.slice(2).length
  ? process.argv.slice(2) : defaultQueries;
if (queries.length > 8 || queries.some(q => typeof q !== "string" || q.length > 180)) {
  throw new Error("INVALID_QUERY_BATCH");
}
const report = {
  sourceId:"amazon-de", mode:"QUERY_DRIVEN_CI_READ_ONLY",
  queriesChecked:queries.length,
  results:[], customerPublishable:false, productionWrites:false,
  totalSearchCandidates:0, totalSafeAsinCandidates:0,
  sourceAccessObserved:false, samePageParityCandidates:0,
};
for (const [index,query] of queries.entries()) {
  const r = await searchAmazonDeUniversal(query,{
    inspectProducts:true,maxPdpChecks:2,
  });
  const d=r.diagnostics;
  const checked = Array.isArray(d.productChecks) ? d.productChecks : [];
  report.results.push({
    queryIndex:index,
    status:d.status,
    failureClass:d.failureClass || null,
    sourceObservation:d.sourceObservation || "UNKNOWN",
    acquisitionClass:d.acquisitionClass || null,
    rawCandidates:d.discoveryCount || 0,
    safeAsinCandidates:d.eligibleCandidateCount || 0,
    pdpChecks:checked.map(x=>x.status),
    samePageParityCandidates:checked.filter(x=>x.samePageParityObserved).length,
    pricePublicationHeld:d.pricePublicationHeld,
  });
  if (r.offers.length || d.customerPublishable !== false ||
      d.pricePublicationHeld !== true) {
    throw Error("AMAZON_DE_CUSTOMER_PRICE_GATE_BROKEN");
  }
  report.totalSearchCandidates += d.discoveryCount || 0;
  report.totalSafeAsinCandidates += d.eligibleCandidateCount || 0;
  report.samePageParityCandidates += checked.filter(x=>x.samePageParityObserved).length;
  report.sourceAccessObserved ||= d.status === "SOURCE_SEARCH_COMPLETED" &&
    d.sourceObservation !== "HTTP_200_BLOCK_PAGE";
}
report.status = report.totalSafeAsinCandidates > 0
  ? "LIVE_CANDIDATES_OBSERVED_NOT_ATTESTED"
  : "NO_LIVE_SOURCE_ASIN_CANDIDATES";
console.log("NAWAA_AMAZON_DE_UNIVERSAL_EVIDENCE " + JSON.stringify(report));
// An Amazon-only acceptance cannot be called successful if none of the
// broad, real queries yields even a source-owned exact ASIN URL.
// Do not fail because independent buybox/SA shipping is still intentionally held.
if (report.totalSafeAsinCandidates === 0) process.exitCode = 2;
