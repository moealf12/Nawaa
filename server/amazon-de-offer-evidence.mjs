// Amazon.de read-only offer evidence (P2): NO customer publication, no persistence.
// Source-declared JSON-LD and rendered same-page buybox are two signals from ONE
// page, not independent seller attestation, Saudi destination price or checkout.
import { load } from "cheerio";
import { extractAmazonDeScopedOffer } from "../src/amazon-de-pdp-identity.mjs";
import { normalizeAmazonDeProductUrl } from "./amazon-de-bulk-url-health.mjs";

const MAX_HTML_BYTES = 3_000_000;
const MAX_REDIRECTS = 2;
const PRICE_REGIONS = [
  "#corePriceDisplay_desktop_feature_div",
  "#corePrice_feature_div",
  "#apex_desktop",
];

function result(status, asin = null, details = {}) {
  return Object.freeze({
    sourceId: "amazon-de",
    status,
    asin,
    sourceDeclaredOfferPresent: false,
    requestedVariantObserved: false,
    selectedSellerObserved: false,
    selectedPriceObserved: false,
    samePageParityObserved: false,
    buyboxIndependentlyAttested: false,
    saudiShippingVerified: false,
    customerPublishable: false,
    ...details,
  });
}

export function parseGermanEuroCents(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\u00a0\u202f]/g, " ").trim();
  if (!value.includes("€")) return null;
  const match = /^(?:€\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})(?:\s*€)?$/.exec(value);
  if (!match) return null;
  const euros = Number(match[1].replace(/\./g, ""));
  const cents = euros * 100 + Number(match[2]);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

const normalizedSeller = raw => String(raw || "").trim().replace(/\s+/g, " ").normalize("NFKC");

export function inspectAmazonDeSamePageOffer(html, sourceUrl, expectedAsin) {
  const url = normalizeAmazonDeProductUrl(sourceUrl, expectedAsin);
  const asin = typeof expectedAsin === "string" ? expectedAsin.toUpperCase() : null;
  if (!url) return result("INVALID_PRODUCT_URL");
  if (typeof html !== "string" || !html.trim() || Buffer.byteLength(html) > MAX_HTML_BYTES)
    return result("HTML_MISSING_OR_TOO_LARGE", asin);
  if (/<title[^>]*>[^<]*(?:captcha|robot check|automated access)/i.test(html))
    return result("CHALLENGE_SUSPECTED", asin);

  const scoped = extractAmazonDeScopedOffer(html, url);
  if (!scoped?.product) return result("SOURCE_DECLARED_OFFER_NOT_ATTESTED", asin, {
    sourceStatus: scoped?.status || "NOT_EXTRACTED",
  });
  const declared = scoped.product;
  const base = { sourceDeclaredOfferPresent: true };
  const $ = load(html);
  const fields = $('input#ASIN, input[name="ASIN"]').toArray();
  const selectedAsins = [...new Set(fields.map(el =>
    String($(el).attr("value") || "").trim().toUpperCase()).filter(Boolean))];
  if (selectedAsins.length !== 1 || selectedAsins[0] !== asin)
    return result("SELECTED_VARIANT_NOT_PROVEN", asin, base);
  base.requestedVariantObserved = true;

  // Only the selected buybox seller link; never a cross-sell merchant label.
  const sellers = [...new Set($("#sellerProfileTriggerId").toArray()
    .map(el => normalizedSeller($(el).text())).filter(Boolean))];
  if (sellers.length !== 1)
    return result("SELECTED_SELLER_NOT_PROVEN", asin, base);
  base.selectedSellerObserved = true;
  if (sellers[0] !== normalizedSeller(declared.sourceDeclaredSeller))
    return result("SOURCE_AND_BUYBOX_SELLER_CONFLICT", asin, base);

  let observedCents = [];
  for (const region of PRICE_REGIONS) {
    const prices = $(region).find(".a-price .a-offscreen").toArray()
      .map(el => parseGermanEuroCents($(el).text()));
    // Unparseable price nodes are ambiguous, never silently filtered out.
    if (prices.length) { observedCents = prices; break; }
  }
  if (observedCents.length !== 1 || observedCents[0] === null)
    return result("SELECTED_PRICE_NOT_PROVEN", asin, base);
  base.selectedPriceObserved = true;
  const declaredPrice = Number(declared.offers?.price);
  const declaredCents = Math.round(declaredPrice * 100);
  if (!Number.isSafeInteger(declaredCents) || observedCents[0] !== declaredCents)
    return result("SOURCE_AND_BUYBOX_PRICE_CONFLICT", asin, base);

  // A same-page match is a diagnostic candidate, NOT independent proof.
  return result("SAME_PAGE_PARITY_CANDIDATE_NOT_ATTESTED", asin, {
    ...base, samePageParityObserved: true,
  });
}

async function readHtmlWithLimit(response) {
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > MAX_HTML_BYTES) return { status: "HTML_TOO_LARGE" };
  if (!response.body?.getReader) return { status: "BODY_NOT_READABLE" };
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) return { status: "HTML_TOO_LARGE" };
      chunks.push(value);
    }
    return { html: new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))) };
  } catch {
    return { status: "BODY_READ_FAILED" };
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

// One explicit product only. No discovery, no proxy, no cookies, no auth,
// no retries and no request triggered by a shopper's search.
export async function probeAmazonDeOffer({
  asin, url, fetchImpl = globalThis.fetch, timeoutMs = 6000, signal,
} = {}) {
  const expected = typeof asin === "string" ? asin.toUpperCase() : "";
  let target = normalizeAmazonDeProductUrl(url, expected);
  if (!target) return result("INVALID_PRODUCT_URL");
  if (signal?.aborted) return result("ABORTED", expected);
  const timeout = AbortSignal.timeout(Math.max(100, Math.min(10000, timeoutMs)));
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const visited = new Set();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (visited.has(target)) return result("REDIRECT_LOOP", expected);
    visited.add(target);
    let response;
    try {
      response = await fetchImpl(target, {
        method: "GET", redirect: "manual",
        headers: { Accept: "text/html", "Accept-Language": "de-DE,de;q=0.9" },
        signal: abort,
      });
    } catch {
      return result(signal?.aborted ? "ABORTED" : timeout.aborted ? "TIMEOUT" : "NETWORK_ERROR", expected);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      try { await response.body?.cancel?.(); } catch {}
      if (hop === MAX_REDIRECTS) return result("REDIRECT_LIMIT", expected);
      const location = response.headers.get("location");
      let next;
      try { next = new URL(location, target).href; } catch { return result("INVALID_REDIRECT", expected); }
      target = normalizeAmazonDeProductUrl(next, expected);
      if (!target) return result("UNSAFE_OR_MISMATCHED_REDIRECT", expected);
      continue;
    }
    if (response.status !== 200) {
      try { await response.body?.cancel?.(); } catch {}
      return result(response.status === 403 || response.status === 429
        ? "ACCESS_RESTRICTED" : response.status === 404 || response.status === 410
        ? "NOT_FOUND" : "HTTP_UNVERIFIED", expected);
    }
    if (!/^text\/html(?:;|$)/i.test(response.headers.get("content-type") || "")) {
      try { await response.body?.cancel?.(); } catch {}
      return result("NON_HTML_RESPONSE", expected);
    }
    const body = await readHtmlWithLimit(response);
    if (!body.html) return result(body.status || "EMPTY_HTML", expected);
    return inspectAmazonDeSamePageOffer(body.html, target, expected);
  }
  return result("REDIRECT_LIMIT", expected);
}
