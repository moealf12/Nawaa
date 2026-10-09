import net from "node:net";

// Optional, explicitly scoped SOURCE DISCOVERY reader.
// Never run this inside /api/search, automatic fallback, or offer verification.
// The Jina response is untrusted, price-unverified third-party Markdown.
const ENDPOINT = "https://r.jina.ai/";
const DEFAULT_OUTPUT_LIMIT = 120_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TARGET_URL = 1_800;
const DEFAULT_HOURLY_LIMIT = 8;
const attempts = [];
let running = false;

export function validateJinaTarget(input, allowedHosts = []) {
  if (typeof input !== "string" || input.length > MAX_TARGET_URL) {
    throw new Error("jina_invalid_url");
  }
  let url;
  try { url = new URL(input); }
  catch { throw new Error("jina_invalid_url"); }
  // No caller-controlled credentials, unusual ports, fragments, local or IP hosts.
  if (url.protocol !== "https:" || url.username || url.password ||
      url.port || url.hash || net.isIP(url.hostname) ||
      url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local") ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) ||
      url.hostname.length > 253) {
    throw new Error("jina_unsafe_url");
  }
  const hosts = new Set(
    (Array.isArray(allowedHosts) ? allowedHosts : [])
      .map(value => String(value).trim().toLowerCase())
      .filter(Boolean),
  );
  // Exact host allowlist; do not allow wildcard subdomains or arbitrary URLs.
  if (!hosts.size || !hosts.has(url.hostname.toLowerCase())) {
    throw new Error("jina_host_not_allowlisted");
  }
  return url.href;
}

export function jinaReaderConfigured(env = process.env) {
  return env.JINA_READER_ENABLED === "1" &&
    typeof env.JINA_API_KEY === "string" &&
    env.JINA_API_KEY.trim().length >= 12 &&
    String(env.JINA_READER_ALLOWED_HOSTS || "").trim().length > 0;
}

async function readBoundedText(response, maxBytes) {
  const length = Number(response.headers?.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("jina_output_too_large");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("jina_output_too_large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("jina_output_too_large");
      chunks.push(value);
    }
    return Buffer.concat(chunks.map(x => Buffer.from(x)), bytes).toString("utf8");
  } finally {
    reader.releaseLock();
    if (bytes > maxBytes) await response.body.cancel().catch(() => {});
  }
}

// A process-local limit is a *second layer of protection*, not a durable quota.
// A restart/multiple instances reset it. The external account's hard cap
// should be checked separately before enabling any background automation.
export async function readJinaPage(pageUrl, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  maxOutputBytes = DEFAULT_OUTPUT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!jinaReaderConfigured(env)) return { status:"disabled", content:null };
  const hosts = String(env.JINA_READER_ALLOWED_HOSTS).split(",").map(x => x.trim());
  const safeTarget = validateJinaTarget(pageUrl, hosts);
  const maximum = Math.min(200_000, Math.max(1_000, Math.floor(Number(maxOutputBytes) || DEFAULT_OUTPUT_LIMIT)));
  const deadline = Math.min(20_000, Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const limit = Math.min(30, Math.max(1, Number(env.JINA_READER_REQUESTS_PER_HOUR) || DEFAULT_HOURLY_LIMIT));
  while (attempts.length && attempts[0] <= now - 3_600_000) attempts.shift();
  if (attempts.length >= limit) return { status:"local_budget_exhausted", content:null };
  if (running) return { status:"busy", content:null };
  // Count attempted requests, even if rejected by Jina; never auto retry.
  attempts.push(now);
  running = true;
  try {
    const response = await fetchImpl(ENDPOINT + safeTarget, {
      method:"GET",
      headers:{
        "Authorization":"Bearer " + env.JINA_API_KEY,
        "Accept":"text/plain",
        "X-Return-Format":"markdown",
      },
      cache:"no-store",
      redirect:"error",
      signal:AbortSignal.timeout(deadline),
    });
    if (response.status === 429) {
      return { status:"upstream_rate_limited", content:null };
    }
    if (response.status === 401 || response.status === 403) {
      return { status:"authentication_failed", content:null };
    }
    if (!response.ok) {
      return { status:"upstream_error", httpStatus:response.status, content:null };
    }
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (type.includes("text/html")) return { status:"unexpected_html", content:null };
    const content = await readBoundedText(response, maximum);
    return {
      status:"ok",
      targetUrl:safeTarget,
      content,
      retrievedAt:new Date(now).toISOString(),
      unverified:true,
      evidenceKind:"third_party_markdown",
    };
  } catch (error) {
    const message = String(error?.message || "");
    // Never serialize fetch exceptions; transports can include request headers.
    return { status:message==="jina_output_too_large" ? message:"request_failed", content:null };
  } finally {
    running = false;
  }
}
