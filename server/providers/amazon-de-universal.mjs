// Query-driven Amazon.de discovery across ALL shopper searches.
// The public search path runs a bounded first-party catalog request, while
// customer price publication remains blocked until independent offer truth.
// No static ASINs, products, queries, paid API, proxy, or private data.
import { normalizeSearchQuery } from "../../src/search-query.mjs";
import { classifySourceError } from "../../src/source-access-intelligence.mjs";
import { searchFreeStorefrontById } from "./free-storefronts.mjs";
import { normalizeAmazonDeProductUrl } from "../amazon-de-bulk-url-health.mjs";
import { probeAmazonDeOffer } from "../amazon-de-offer-evidence.mjs";

const MAX_QUERY_LENGTH = 180;
const MAX_PDP_CHECKS = 3;
const MAX_ACTIVE_SEARCHES = 2;
let activeSearches = 0;

export function amazonDeCandidateFromUrl(raw) {
  if (typeof raw !== "string") return null;
  let asin;
  try {
    asin = /^\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i
      .exec(new URL(raw).pathname)?.[1]?.toUpperCase();
  } catch { return null; }
  if (!asin) return null;
  const url = normalizeAmazonDeProductUrl(raw, asin);
  return url ? Object.freeze({ asin, url }) : null;
}

export function amazonDeDiscoveredCandidates(result, limit = 12) {
  const sample = Array.isArray(result?.diagnostics?.amazonDeCandidateSamples)
    ? result.diagnostics.amazonDeCandidateSamples
    : Array.isArray(result?.diagnostics?.candidateSamples)
      ? result.diagnostics.candidateSamples : [];
  const count = Math.min(20, Math.max(0, Number.isFinite(Number(limit))
    ? Math.floor(Number(limit)) : 12));
  const seen = new Set(), candidates = [];
  for (const raw of sample) {
    const c = amazonDeCandidateFromUrl(raw);
    if (!c || seen.has(c.asin)) continue;
    seen.add(c.asin);
    candidates.push(c);
    if (candidates.length >= count) break;
  }
  return candidates;
}

export async function searchAmazonDeUniversal(query, {
  signal, discover = searchFreeStorefrontById,
  inspectProducts = false, maxPdpChecks = 0,
  probe = probeAmazonDeOffer, maxQueryLength = MAX_QUERY_LENGTH,
} = {}) {
  const normalized = normalizeSearchQuery(String(query ?? ""));
  const empty = (status, extras = {}) => ({
    provider: "amazon-de-universal",
    sourceId: "amazon-de",
    ok: false, offers: [], candidates: 0, errors: [],
    searchedMarkets: [{ id: "amazon-de", countryCode: "DE" }],
    diagnostics: {
      status, pricePublicationHeld: true,
      customerPublishable: false, sourceId: "amazon-de",
      sourceQueryDriven: true, ...extras,
    },
  });
  if (!normalized || normalized.length > maxQueryLength) return empty("QUERY_NOT_ELIGIBLE");
  if (signal?.aborted) return empty("ABORTED");
  if (activeSearches >= MAX_ACTIVE_SEARCHES) return empty("SOURCE_BUSY");
  activeSearches++;
  try {
    // One source-owned search for *this* user query, never a fixed product URL.
    const source = await discover("amazon-de", normalized, {
      signal, matchingQuery: normalized, perStore: Infinity,
      catalogLimit: Infinity, storeDeadlineMs: 5500, productPageLimit: 0,
    });
    const gate = source?.diagnostics?.customerPublicationGate;
    if (gate?.customerPublishable !== false) {
      // A missing or weakened publication gate is never a reason to publish.
      return empty("PRICE_GATE_MISSING_OR_OPEN");
    }
    const candidates = amazonDeDiscoveredCandidates(source);
    const diagnostics = {
      status: "SOURCE_SEARCH_COMPLETED",
      sourceId: "amazon-de",
      sourceQueryDriven: true,
      customerPublishable: false,
      pricePublicationHeld: true,
      sourceObservation: source?.diagnostics?.sourceObservation || "UNKNOWN",
      acquisitionClass: source?.diagnostics?.amazonDeAcquisition?.classification || null,
      // Bound to counts, never emit raw HTML, ASIN, seller, price or query.
      discoveryCount: Math.max(0, Number(source?.candidates) || 0),
      eligibleCandidateCount: candidates.length,
      productChecks: [],
      sourceErrors: Math.max(0, Number(source?.failures) || 0),
    };
    if (inspectProducts && maxPdpChecks > 0) {
      // ONLY for explicitly authorized read-only diagnostics, NOT shopper flow.
      const count = Math.min(MAX_PDP_CHECKS,Math.max(0, Math.trunc(maxPdpChecks)));
      for (const candidate of candidates.slice(0,count)) {
        if (signal?.aborted) break;
        let evidence;
        try {
          evidence = await probe({...candidate,signal,timeoutMs:5000});
        } catch {
          evidence = {status: "PROBE_ERROR",samePageParityObserved: false};
        }
        diagnostics.productChecks.push({
          status: evidence.status,
          samePageParityObserved: evidence.samePageParityObserved === true,
        });
      }
    }
    // Search candidates or same-page parity NEVER become customer offers here.
    return {
      provider: "amazon-de-universal", sourceId: "amazon-de",
      ok: true, offers: [], candidates: candidates.length,
      errors: [], searchedMarkets: [{ id: "amazon-de",countryCode: "DE" }],
      diagnostics,
    };
  } catch (error) {
    return empty(signal?.aborted ? "ABORTED" : "SOURCE_SEARCH_UNAVAILABLE", {
      failureClass: classifySourceError(error).failureClass,
    });
  } finally {
    activeSearches--;
  }
}
