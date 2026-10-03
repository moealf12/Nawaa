import { normalizeSearchQuery } from '../src/search-query.mjs';

// Offer adapters expose model/MPN and SKU in separate fields. Keep their
// namespaces intact when comparing catalog data with a freshly resolved page.
export function sameOfferIdentity(left, right) {
  try {
    const a = new URL(left.sourceUrl), b = new URL(right.sourceUrl);
    const host = u => u.hostname.toLowerCase().replace(/^www\./, '');
    const listingPath = u => {
      const normalized=u.pathname.replace(/\/+$/,'');
      // eXtra redirects its public /en-sa/p/ID search links to category/slug
      // paths ending in /p/ID. Only this merchant, market and exact ID alias.
      if(host(u)==='extra.com'){
        const id=normalized.match(/^\/en-sa\/(?:[^?#]+\/)?p\/(\d+)$/)?.[1];
        if(id)return '/en-sa/p/'+id;
      }
      return normalized;
    };
    const sameListing = u => a.protocol === 'https:' && u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && host(a) === host(u) && listingPath(a) === listingPath(u) && (!a.searchParams.has('variant') || a.searchParams.get('variant') === u.searchParams.get('variant'));
    // Structured Offer.url is untrusted data: it cannot conceal the URL fetched.
    if (!sameListing(b) || (right.resolvedPageUrl && !sameListing(new URL(right.resolvedPageUrl)))) return false;
    const identity = offer => ({title:offer.title,brand:offer.brand || offer.specs?.brand,sku:offer.sku,model:offer.specs?.modelNumber,gtin:offer.specs?.barcode});
    const same = compareProductIdentity(identity(left), identity(right));
    if (same.conflicts.length) return false;
    const identifier = same.matches.some(value => ['sku','gtin','model'].includes(value));
    const exactTitle = normalizeSearchQuery(left.title) === normalizeSearchQuery(right.title);
    return ['same','likely_same'].includes(same.verdict) && (identifier || exactTitle);
  } catch { return false; }
}

function clean(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return clean(value).replace(/\s+/g, "");
}

function brandOf(product) {
  const value = product?.brand;
  if (typeof value === "string") return clean(value);
  if (value && typeof value === "object") return clean(value.name || value.title);
  return "";
}

function modelOf(product) {
  const value = product?.model;
  if (typeof value === "string") return compact(value);
  if (value && typeof value === "object") return compact(value.name || value.title);
  return compact(product?.modelNumber || product?.mpn);
}

function skuOf(product) {
  return compact(product?.sku || product?.productId || product?.product_id);
}

function gtinOf(product) {
  return compact(product?.gtin14 || product?.gtin13 || product?.gtin12 || product?.gtin || product?.barcode);
}

function titleTokens(value) {
  return new Set(clean(value).split(" ").filter((token) => token.length > 1));
}

function titleSimilarity(a, b) {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (!left.size || !right.size) return null;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return overlap / Math.max(left.size, right.size);
}

function exactEvidence(label, a, b, weight, matches, conflicts) {
  if (!a || !b) return 0;
  if (a === b) {
    matches.push(label);
    return weight;
  }
  conflicts.push(label);
  return -weight;
}

export function productIdentity(product = {}) {
  return {
    title: clean(product?.name || product?.title),
    brand: brandOf(product),
    model: modelOf(product),
    sku: skuOf(product),
    gtin: gtinOf(product),
  };
}

export function compareProductIdentity(leftProduct = {}, rightProduct = {}) {
  const left = productIdentity(leftProduct);
  const right = productIdentity(rightProduct);
  const matches = [];
  const conflicts = [];
  let score = 0.5;

  score += exactEvidence("gtin", left.gtin, right.gtin, 0.45, matches, conflicts);
  score += exactEvidence("sku", left.sku, right.sku, 0.35, matches, conflicts);
  score += exactEvidence("model", left.model, right.model, 0.22, matches, conflicts);

  if (left.brand && right.brand) {
    if (left.brand === right.brand) {
      matches.push("brand");
      score += 0.12;
    } else {
      conflicts.push("brand");
      score -= 0.22;
    }
  }

  const similarity = titleSimilarity(left.title, right.title);
  if (similarity !== null) {
    if (similarity >= 0.75) {
      matches.push("title");
      score += 0.16;
    } else if (similarity >= 0.45) {
      score += 0.06;
    } else if (similarity < 0.2) {
      conflicts.push("title");
      score -= 0.28;
    }
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  const strongConflict = conflicts.includes("gtin") ||
    (conflicts.includes("sku") && matches.length === 0) ||
    (conflicts.includes("model") && conflicts.includes("brand"));

  let verdict = "uncertain";
  if (strongConflict || score < 0.3) verdict = "different";
  else if (score >= 0.78 || matches.includes("gtin") || matches.includes("sku")) verdict = "same";
  else if (score >= 0.58) verdict = "likely_same";

  return {
    score,
    verdict,
    matches,
    conflicts,
    titleSimilarity: similarity === null ? null : Number(similarity.toFixed(3)),
    left,
    right,
  };
}

function sourceKey(entry) {
  return entry?.adapterId ? `${entry.strategy}:${entry.adapterId}` : entry?.strategy || "unknown";
}

export function identityCluster(candidates = [], anchorEntry = null) {
  if (!candidates.length) {
    return { anchor:null, accepted:[], rejected:[], comparisons:[], summary:{accepted:0,rejected:0} };
  }

  const anchor = anchorEntry || [...candidates].sort((a,b) => (b.confidence || 0) - (a.confidence || 0))[0];
  const accepted = [];
  const rejected = [];
  const comparisons = [];

  for (const entry of candidates) {
    if (entry === anchor) {
      accepted.push(entry);
      comparisons.push({
        source:sourceKey(entry),
        score:1,
        verdict:"same",
        matches:["anchor"],
        conflicts:[],
      });
      continue;
    }

    const comparison = compareProductIdentity(anchor.product, entry.product);
    const row = { source:sourceKey(entry), ...comparison };
    comparisons.push(row);

    if (comparison.verdict === "different") rejected.push(entry);
    else accepted.push(entry);
  }

  return {
    anchor,
    accepted,
    rejected,
    comparisons,
    summary:{
      accepted:accepted.length,
      rejected:rejected.length,
      rejectedSources:rejected.map(sourceKey),
      anchorSource:sourceKey(anchor),
    },
  };
}
