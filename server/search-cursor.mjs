import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_SEARCH_DEPTH = 2;
export const SEARCH_CURSOR_TTL_MS = 15 * 60 * 1000;

const secretMaterial =
  process.env.NAWAA_CURSOR_SECRET ||
  process.env.NAWAA_INGEST_TOKEN ||
  process.env.RENDER_SERVICE_ID ||
  randomBytes(32).toString("hex");
const secret = Buffer.from(secretMaterial);

function fingerprint(query) {
  return createHash("sha256").update(String(query)).digest("base64url").slice(0, 22);
}

function signature(body) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function encodeSearchCursor(query, depth, { now = Date.now() } = {}) {
  const d = Number(depth);
  if (!Number.isInteger(d) || d < 1 || d > MAX_SEARCH_DEPTH) throw new Error("invalid_search_depth");
  const body = Buffer.from(JSON.stringify({ v:1, q:fingerprint(query), d, t:now }), "utf8").toString("base64url");
  return body + "." + signature(body);
}

export function decodeSearchCursor(token, query, { now = Date.now(), maxAgeMs = SEARCH_CURSOR_TTL_MS } = {}) {
  const value = String(token || "");
  if (value.length < 20 || value.length > 512) throw new Error("invalid_search_cursor");
  const [body, supplied, extra] = value.split(".");
  if (!body || !supplied || extra) throw new Error("invalid_search_cursor");
  const expected = Buffer.from(signature(body));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("invalid_search_cursor");

  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { throw new Error("invalid_search_cursor"); }

  if (payload?.v !== 1 || payload.q !== fingerprint(query) ||
      !Number.isInteger(payload.d) || payload.d < 1 || payload.d > MAX_SEARCH_DEPTH ||
      !Number.isFinite(payload.t) || payload.t > now + 60000 || now - payload.t > maxAgeMs) {
    throw new Error("invalid_search_cursor");
  }
  return { depth:payload.d, issuedAt:payload.t };
}

export function acquisitionPlan(depth = 0, storefrontCount = 43) {
  const d = Math.max(0, Math.min(MAX_SEARCH_DEPTH, Math.floor(Number(depth) || 0)));
  const totalStores = Math.max(1, Math.min(64, Math.floor(Number(storefrontCount) || 1)));
  const levels = [
    { depth:0, amazonPages:5, storefrontLimit:Math.min(16,totalStores), productPageLimit:4, jarirLimit:24, returnLimit:120 },
    { depth:1, amazonPages:8, storefrontLimit:Math.min(28,totalStores), productPageLimit:6, jarirLimit:48, returnLimit:300 },
    { depth:2, amazonPages:8, storefrontLimit:totalStores, productPageLimit:8, jarirLimit:48, returnLimit:600 },
  ];
  return levels[d];
}
