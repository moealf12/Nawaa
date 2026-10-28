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

// Search and PDP fetchers share one honest header profile. Existing merchants
// keep their old behavior; never accept arbitrary user-controlled header keys.
export function merchantRequestHeaders(sourceId, existing = {}) {
  return sourceId === "thomann-de" ? {...THOMANN_HEADERS} : {...existing};
}

export function productPageRequestHeaders(rawUrl, existing = {}) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" &&
        url.hostname.toLowerCase() === "www.thomann.de" &&
        (!url.port || url.port === "443") &&
        !url.username && !url.password) {
      return merchantRequestHeaders("thomann-de");
    }
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
