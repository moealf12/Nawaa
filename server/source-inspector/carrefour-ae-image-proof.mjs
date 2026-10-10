// Read-only Carrefour UAE image qualification. Not imported by customer search.
const MAX_PROBES = 8;
const MAX_CONCURRENCY = 2;
const HOST = "www.carrefouruae.com";
const MODEL_FLAGS = new Set(["pro", "max", "plus", "ultra", "mini", "air", "lite", "neo"]);

function productLocation(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== HOST ||
        url.username || url.password) return null;
    const id = url.pathname.match(/^\/mafuae\/en\/(?:.+\/)?p\/(\d+)(?:\/)?$/i)?.[1];
    return id ? { id, url: url.href } : null;
  } catch { return null; }
}

function tokens(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/(\d+)\s*(gb|tb)\b/g, "$1$2")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .split(/\s+/).filter(Boolean)
    .filter(token => !new Set(["buy", "online", "from", "with", "and", "the", "carrefour", "uae"]).has(token));
}

function consistentTitle(a, b) {
  const aTokens = new Set(tokens(a)), bTokens = new Set(tokens(b));
  if (aTokens.size < 3 || bTokens.size < 3) return false;
  const matched = [...aTokens].filter(token => bTokens.has(token)).length;
  if (matched < 3 || matched / aTokens.size < 0.75 ||
      matched / bTokens.size < 0.5) return false;
  for (const flag of MODEL_FLAGS) {
    if (aTokens.has(flag) !== bTokens.has(flag)) return false;
  }
  // Search cards define the requested variant. Do not accept a PDP for another capacity.
  for (const token of aTokens) {
    if (/^\d+(?:gb|tb)$/.test(token) && !bTokens.has(token)) return false;
  }
  return true;
}

function offerPrice(product) {
  const raw = product?.offers;
  const offers = Array.isArray(raw) ? raw : raw?.offers && Array.isArray(raw.offers) ? raw.offers : raw ? [raw] : [];
  return offers.map(entry => {
    const amount = entry?.price ?? entry?.lowPrice;
    const price = typeof amount === "number" ? amount :
      /^\d+(?:\.\d+)?$/.test(String(amount || "").replace(/,/g, "")) ?
        Number(String(amount).replace(/,/g, "")) : null;
    return { price, currency: String(entry?.priceCurrency || "").toUpperCase() };
  }).filter(value => Number.isFinite(value.price) && value.price > 0);
}

function officialImageLocation(value, expectedId) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        url.hostname !== "cdn.mafrservices.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const prefix = ["pim-content","UAE","media","product"];
    if (!prefix.every((segment, index) => segments[index] === segment) ||
        segments[4] !== String(expectedId) || segments.length !== 7 ||
        !/^\d{8,12}$/.test(segments[5]) ||
        !new RegExp("^"+String(expectedId)+"_main\\.(?:jpe?g|png|webp)$","i")
          .test(segments[6])) return null;
    return url.href;
  } catch { return null; }
}

function candidateImage(product, finalUrl, expectedId) {
  const raw = Array.isArray(product?.image) ? product.image[0] : product?.image;
  const ref = typeof raw === "string" ? raw : raw?.url || raw?.src;
  if (typeof ref !== "string" || !ref.trim()) return null;
  try {
    return officialImageLocation(new URL(ref, finalUrl).href, expectedId);
  } catch { return null; }
}

/** Audit-only HEAD gate: validates CDN response without fetching image bytes. */
export async function verifyCarrefourAeImageHead(image, expectedId, { fetchImpl = fetch } = {}) {
  const target = officialImageLocation(image, expectedId);
  if (!target) return { ok:false, reason:"image_identity_or_domain_mismatch" };
  try {
    const response = await fetchImpl(target,{
      method:"HEAD", redirect:"manual", signal:AbortSignal.timeout(6000),
      headers:{accept:"image/jpeg,image/png,image/webp"},
    });
    const contentType = String(response.headers.get("content-type")||"")
      .split(";")[0].trim().toLowerCase();
    const lengthRaw = response.headers.get("content-length");
    const length = lengthRaw === null ? null : Number(lengthRaw);
    if (response.status !== 200)
      return {ok:false,reason:"image_http_"+response.status};
    if (!["image/jpeg","image/png","image/webp"].includes(contentType))
      return {ok:false,reason:"image_content_type_mismatch",observedContentType:contentType,observedLength:length};
    if (length !== null && (!Number.isSafeInteger(length) || length < 512 ||
        length > 20_000_000))
      return {ok:false,reason:"image_length_out_of_bounds",observedContentType:contentType,observedLength:length};
    return {ok:true,httpStatus:response.status,contentType,bytes:length};
  } catch (error) {
    return {ok:false,reason:"image_head_request_failed",
      detail:String(error?.message||error).slice(0,120)};
  }
}

function explicitIdentityMismatch(product, expectedId) {
  const refs = [product?.url, product?.["@id"], product?.offers?.url];
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    const match = ref.match(/\/p\/(\d+)(?:[/?#]|$)/i);
    if (match && match[1] !== expectedId) return true;
  }
  const sku = String(product?.sku ?? product?.productID ?? "").trim();
  // Only Carrefour-style numeric page IDs are comparable to /p/<id>.
  return /^\d{6,16}$/.test(sku) && sku !== expectedId;
}

export function verifyCarrefourAeImageFromPage(offer, page) {
  const requested = productLocation(offer?.sourceUrl);
  if (!requested) return { accepted:false, reason:"invalid_product_url" };
  if (String(offer?.originalCurrency || "").toUpperCase() !== "AED" ||
      !Number.isFinite(Number(offer?.originalProductPrice)) ||
      Number(offer.originalProductPrice) <= 0)
    return { accepted:false, reason:"invalid_original_price" };
  const landing = productLocation(page?.finalUrl);
  if (!landing || landing.id !== requested.id)
    return { accepted:false, reason:"product_redirect_mismatch" };
  let reason = "no_matching_page_candidate";
  for (const candidate of page?.candidates || []) {
    const product = candidate?.product;
    if (!product || typeof product !== "object") continue;
    if (explicitIdentityMismatch(product, requested.id)) {
      reason = "product_identity_mismatch"; continue;
    }
    if (!consistentTitle(offer.title, product.name)) {
      reason = "product_title_mismatch"; continue;
    }
    const prices = offerPrice(product);
    if (!prices.some(p => p.currency === "AED")) {
      reason = "missing_aed_price_evidence"; continue;
    }
    if (!prices.some(p => p.currency === "AED" &&
        Math.abs(p.price - Number(offer.originalProductPrice)) < 0.005)) {
      reason = "product_price_mismatch"; continue;
    }
    const image = candidateImage(product, landing.url, requested.id);
    if (!image) { reason = "missing_safe_product_image"; continue; }
    return {
      accepted:true, image, reason:"verified",
      evidence: {
        productId:requested.id, strategy:String(candidate.strategy || "unknown"),
        originalPriceAED:Number(offer.originalProductPrice),
        matchedTitle:product.name, officialProductUrl:landing.url,
      },
    };
  }
  return { accepted:false, reason };
}

const CARREFOUR_UA_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export async function fetchCarrefourAeBrowserPage(input, {fetchImpl = fetch} = {}) {
  const source = productLocation(input);
  if (!source) throw new Error("invalid_carrefour_product_url");
  let next = source.url;
  for (let redirect = 0; redirect <= 2; redirect++) {
    // The caller is restricted to Carrefour UAE official PDPs; never follow off-site redirects.
    const response = await fetchImpl(next, {
      headers:{
        accept:"text/html,application/xhtml+xml",
        "accept-language":"en-US,en;q=0.9,ar-SA;q=0.8",
        "cache-control":"no-cache",
        pragma:"no-cache",
        "sec-fetch-dest":"document",
        "sec-fetch-mode":"navigate",
        "sec-fetch-site":"none",
        "upgrade-insecure-requests":"1",
        "user-agent":CARREFOUR_UA_BROWSER_UA,
      },
      redirect:"manual",
      signal:AbortSignal.timeout(8000),
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("carrefour_redirect_without_location");
      const target = new URL(location,next).href;
      const resolved = productLocation(target);
      if (!resolved || resolved.id !== source.id) throw new Error("carrefour_unsafe_product_redirect");
      next = target; continue;
    }
    if (!response.ok) throw new Error("carrefour_http_"+response.status);
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml"))
      throw new Error("carrefour_non_html_response");
    const chunks=[]; let size=0;
    if (!response.body) throw new Error("carrefour_empty_body");
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 5_000_000) throw new Error("carrefour_html_size_limit");
      chunks.push(Buffer.from(chunk));
    }
    const html=Buffer.concat(chunks).toString("utf8");
    if (html.length < 200) throw new Error("carrefour_block_or_empty_html");
    const { extractionCandidates } = await import("../url-resolver.mjs");
    return {finalUrl:next, html, candidates:extractionCandidates(html,next)};
  }
  throw new Error("carrefour_too_many_redirects");
}

async function defaultLoadProduct(url) {
  return fetchCarrefourAeBrowserPage(url);
}

// An explicit, bounded proof run. It does not mutate persistence or activate a source.
export async function proveCarrefourAeImages(offers, {
  limit = MAX_PROBES, concurrency = MAX_CONCURRENCY, loadProduct = defaultLoadProduct,
  imageHead = null,
} = {}) {
  const sample = (Array.isArray(offers) ? offers : []).slice(
    0, Math.max(0, Math.min(MAX_PROBES, Math.floor(Number(limit) || 0)))
  );
  const result = new Array(sample.length);
  let cursor = 0;
  async function worker() {
    while (cursor < sample.length) {
      const index = cursor++;
      const offer = sample[index], target = productLocation(offer?.sourceUrl);
      if (!target) { result[index] = { accepted:false, reason:"invalid_product_url" }; continue; }
      try {
        const page = await loadProduct(target.url);
        const proof = verifyCarrefourAeImageFromPage(offer, page);
        if (proof.accepted && typeof imageHead === "function") {
          const health = await imageHead(proof.image, proof.evidence.productId);
          result[index] = health?.ok
            ? {...proof, imageHttpVerified:true, imageHttpStatus:health.httpStatus,
                imageContentType:health.contentType}
            : {accepted:false, reason:health?.reason || "image_head_failed",
                imageHeadContentType:health?.observedContentType || null,
                imageHeadContentLength:health?.observedLength ?? null};
        } else {
          result[index] = proof;
        }
      } catch (error) {
        result[index] = { accepted:false, reason:"product_page_fetch_failed",
          detail:String(error?.message || error).slice(0, 160) };
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(
    MAX_CONCURRENCY, Math.max(1, Math.floor(Number(concurrency) || 1)), sample.length
  )}, worker));
  const accepted = result.filter(x => x?.accepted).length;
  return {
    source:"carrefour-ae", mode:"isolated-read-only",
    attempted:sample.length, accepted, rejected:sample.length - accepted,
    imageCoverage:sample.length ? accepted / sample.length : 0,
    // Results correspond positionally to the input sample; do not write them to live offers.
    results:result,
  };
}
