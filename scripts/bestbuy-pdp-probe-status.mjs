// Pure, deterministic classification of bounded Best Buy PDP probe failures.
// Timed-out probes do not establish merchant blocks, inventory or price absence.
export function classifyPdpProbeFailure(stages, error) {
  const events = new Set(Array.isArray(stages) ? stages.map(item =>
    typeof item === 'string' ? item : item?.stage).filter(Boolean) : []);
  const timedOut = error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' && /timeout/i.test(String(error?.message || '')) ||
    /(?:timed? out|timeout)/i.test(String(error?.message || ''));
  if (!timedOut) return 'PDP_UNVERIFIED';
  if (events.has('fx_conversion_start') && !events.has('fx_conversion_done')) return 'PDP_FX_TIMEOUT';
  if (events.has('reconciliation_start') || events.has('extraction_start')) return 'PDP_EXTRACTION_TIMEOUT';
  if (events.has('response_headers')) return 'PDP_RESPONSE_BODY_TIMEOUT';
  if (events.has('tls_connected')) return 'PDP_HTTP_HEADERS_TIMEOUT';
  if (events.has('tcp_connected')) return 'PDP_TLS_OR_HEADERS_TIMEOUT';
  if (events.has('request_start')) return 'PDP_CONNECTION_TIMEOUT';
  if (events.has('dns_lookup_start')) return 'PDP_DNS_TIMEOUT';
  return 'PDP_TIMEOUT_STAGE_UNKNOWN';
}
