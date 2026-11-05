// Transparent, source-scoped HTTP representation for public document reads.
// This does not alter TLS/JA3, rotate IP addresses, replay after denial, or
// claim to be Chrome/Firefox. Keep the fetch transport and DNS policies intact.
export const NAWAA_INDEXER_USER_AGENT =
  "NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)";

const THOMANN_HEADERS = Object.freeze({
  accept: "text/html,application/xhtml+xml;q=0.9",
  "accept-language": "de-DE,de;q=0.9,en;q=0.5",
  "user-agent": NAWAA_INDEXER_USER_AGENT,
});

// AliExpress's 200/reCAPTCHA response is a challenge, not a price-bearing
// product page. These headers identify NAWAA truthfully; they do NOT attest
// human activity or bypass access controls. Keep the request deterministic.
const ALIEXPRESS_HEADERS = Object.freeze({
  accept: "text/html,application/xhtml+xml;q=0.9",
  "accept-language": "ar-SA,ar;q=0.9,en;q=0.5",
  "user-agent": NAWAA_INDEXER_USER_AGENT,
});

function isAliExpressPublicHost(hostname) {
  return /^(?:(?:www|m|[a-z]{2})\.)?aliexpress\.(?:com|us)$/i.test(hostname);
}

// Search and PDP fetchers share one honest header profile. All other merchants
// keep their old behavior; never accept arbitrary user-controlled header keys.
export function merchantRequestHeaders(sourceId, existing = {}) {
  if (sourceId === "thomann-de") return {...THOMANN_HEADERS};
  if (sourceId === "aliexpress-cn") return {...ALIEXPRESS_HEADERS};
  return {...existing};
}

export function productPageRequestHeaders(rawUrl, existing = {}) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || (url.port && url.port !== "443") ||
        url.username || url.password) return {...existing};
    if (url.hostname.toLowerCase() === "www.thomann.de")
      return merchantRequestHeaders("thomann-de");
    if (isAliExpressPublicHost(url.hostname))
      return merchantRequestHeaders("aliexpress-cn");
  } catch {}
  return {...existing};
}

// A compact status is evidence of the *response*, never evidence of the WAF
// vendor, TLS fingerprint, source permission, or inventory status.
export function observedSourceHttpStatus(error) {
  const status = Number(error?.status || error?.statusCode);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  const message = String(error?.message || error || "");
  const match = message.match(/(?:\bHTTP\s+|\breturned\s+)([1-5]\d{2})\b/i);
  return match ? Number(match[1]) : null;
}
