const DEFAULT_WEIGHT = {
  jsonld: 1.00,
  domain_adapter: 0.99,
  embedded_json: 0.97,
  storefront_data: 0.96,
  hydrated_state: 0.94,
  meta: 0.75,
};

const FIELD_WEIGHT = {
  price: { domain_adapter:1.12, storefront_data:1.08, embedded_json:1.04, jsonld:1.00, hydrated_state:0.98, meta:0.72 },
  availability: { domain_adapter:1.12, storefront_data:1.08, embedded_json:1.04, jsonld:1.00, hydrated_state:0.98, meta:0.72 },
  name: { jsonld:1.08, domain_adapter:1.05, embedded_json:1.02, storefront_data:1.00, hydrated_state:0.97, meta:0.72 },
  identity: { jsonld:1.08, domain_adapter:1.05, embedded_json:1.02, storefront_data:1.00, hydrated_state:0.97, meta:0.72 },
};

function sourceKey(entry) {
  return entry?.adapterId ? `${entry.strategy}:${entry.adapterId}` : entry?.strategy || "unknown";
}

function rank(entry, field = null) {
  const table = field ? FIELD_WEIGHT[field] : null;
  const weight = table?.[entry?.strategy] ?? DEFAULT_WEIGHT[entry?.strategy] ?? 0.8;
  return Number(entry?.confidence || 0) * weight;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function textSimilarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common++;
  return common / Math.max(left.size, right.size);
}

function offerOf(product) {
  const raw = product?.offers;
  const offers = Array.isArray(raw) ? raw : raw?.offers && Array.isArray(raw.offers) ? raw.offers : raw ? [raw] : [];
  for (const offer of offers) {
    const price = Number(offer?.price ?? offer?.lowPrice ?? offer?.highPrice);
    const currency = String(offer?.priceCurrency || "").toUpperCase();
    if (Number.isFinite(price) && currency) {
      return {
        price,
        currency,
        availability: String(offer?.availability || "").toLowerCase(),
      };
    }
  }
  return null;
}

function best(entries, field = null) {
  return [...entries].sort((a,b) => rank(b, field) - rank(a, field))[0] || null;
}

export function choosePreferredCandidate(candidates = [], field = null, predicate = null) {
  const eligible = predicate ? candidates.filter(predicate) : candidates;
  return best(eligible, field);
}

export function detectCandidateConflicts(candidates = []) {
  const conflicts = [];
  const offers = candidates
    .map((entry) => ({ entry, offer:offerOf(entry.product) }))
    .filter((item) => item.offer);

  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i], b = offers[j];
      if (a.offer.currency !== b.offer.currency) continue;
      const base = Math.max(Math.abs(a.offer.price), Math.abs(b.offer.price), 1);
      const deltaPct = Math.abs(a.offer.price - b.offer.price) / base;
      if (deltaPct >= 0.03) {
        const winner = best([a.entry,b.entry], "price");
        conflicts.push({
          field:"price",
          severity:deltaPct >= 0.15 ? "high" : "medium",
          values:[
            { source:sourceKey(a.entry), value:a.offer.price, currency:a.offer.currency, confidence:a.entry.confidence || 0 },
            { source:sourceKey(b.entry), value:b.offer.price, currency:b.offer.currency, confidence:b.entry.confidence || 0 },
          ],
          deltaPct:Number(deltaPct.toFixed(4)),
          resolvedSource:sourceKey(winner),
          resolution:"higher_ranked_source",
        });
      }

      const avA = a.offer.availability;
      const avB = b.offer.availability;
      if (avA && avB && avA !== avB && /stock|available|unavailable|soldout/.test(avA + " " + avB)) {
        const winner = best([a.entry,b.entry], "availability");
        conflicts.push({
          field:"availability",
          severity:"medium",
          values:[
            { source:sourceKey(a.entry), value:avA, confidence:a.entry.confidence || 0 },
            { source:sourceKey(b.entry), value:avB, confidence:b.entry.confidence || 0 },
          ],
          resolvedSource:sourceKey(winner),
          resolution:"higher_ranked_source",
        });
      }
    }
  }

  const named = candidates.filter((entry) => entry.product?.name);
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const similarity = textSimilarity(named[i].product.name, named[j].product.name);
      if (similarity < 0.45) {
        const winner = best([named[i],named[j]], "name");
        conflicts.push({
          field:"name",
          severity:similarity < 0.2 ? "high" : "medium",
          values:[
            { source:sourceKey(named[i]), value:named[i].product.name, confidence:named[i].confidence || 0 },
            { source:sourceKey(named[j]), value:named[j].product.name, confidence:named[j].confidence || 0 },
          ],
          similarity:Number(similarity.toFixed(4)),
          resolvedSource:sourceKey(winner),
          resolution:"higher_ranked_source",
        });
      }
    }
  }

  return conflicts;
}

export function conflictSummary(conflicts = []) {
  return {
    hasConflicts: conflicts.length > 0,
    count: conflicts.length,
    highSeverity: conflicts.filter((item) => item.severity === "high").length,
    fields:[...new Set(conflicts.map((item) => item.field))],
  };
}
