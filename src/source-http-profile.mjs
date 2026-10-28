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
const BIKE24_HEADERS = Object.freeze({
  accept: "text/html,application/xhtml+xml;q=0.9",
  "accept-language": "en-GB,en;q=0.9,de;q=0.4",
  "user-agent": NAWAA_INDEXER_USER_AGENT,
});
const AMAZON_DE_HEADERS = Object.freeze({
  accept: "text/html,application/xhtml+xml;q=0.9",
  "accept-language": "de-DE,de;q=0.9,en;q=0.5",
  "user-agent": NAWAA_INDEXER_USER_AGENT,
});

// Search and PDP fetchers share one honest header profile. Existing merchants
// keep their old behavior; never accept arbitrary user-controlled header keys.
export function merchantRequestHeaders(sourceId, existing = {}) {
  if(sourceId==="thomann-de")return {...THOMANN_HEADERS};
  if(sourceId==="bike24-de")return {...BIKE24_HEADERS};
  if(sourceId==="amazon-de")return {...AMAZON_DE_HEADERS};
  return {...existing};
}

export function productPageRequestHeaders(rawUrl, existing = {}) {
  try {
    const url = new URL(rawUrl);
    if(url.protocol!=="https:" || (url.port && url.port!=="443") ||
       url.username||url.password)return {...existing};
    const host=url.hostname.toLowerCase();
    if(host==="www.thomann.de")return merchantRequestHeaders("thomann-de");
    if(host==="www.bike24.com")return merchantRequestHeaders("bike24-de");
    if(host==="www.amazon.de")return merchantRequestHeaders("amazon-de");
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
