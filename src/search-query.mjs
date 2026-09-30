// Shared by the API and browser: aliases affect matching and provider queries alike.
const ALIASES = [
  ["اي فون", "iphone"], ["ايفون", "iphone"], ["اير بودز", "airpods"], ["ايربودز", "airpods"],
  ["بلاي ستيشن", "playstation"], ["بلايستيشن", "playstation"],
  ["سامسونج", "samsung"], ["جالاكسي", "galaxy"], ["جالكسي", "galaxy"],
  ["ابل", "apple"], ["دايسون", "dyson"], ["سوني", "sony"],
  ["برو", "pro"], ["ماكس", "max"], ["بلس", "plus"], ["الترا", "ultra"], ["اير", "air"],
  ["جيجابايت", "gb"], ["جيجا بايت", "gb"], ["جيجا", "gb"], ["تيرابايت", "tb"],
  ["اسود", "black"], ["ابيض", "white"], ["لافندر", "lavender"], ["ازرق", "blue"],
  ["اخضر", "green"], ["ذهبي", "gold"], ["فضي", "silver"],
  ["كفر", "case"], ["حافظه", "case"], ["شاحن", "charger"], ["كيبل", "cable"],
  ["مجدد", "refurbished"], ["مستعمل", "used"], ["جديد", "new"],
];

export function normalizeSearchQuery(value = "") {
  let text = String(value).normalize("NFKC").toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

  text = text.replace(/([ء-ي])(?=\d)/g, "$1 ").replace(/(\d)(?=جيجا|تيرا)/g, "$1 ");
  for (const [alias, canonical] of ALIASES) {
    text = text.replace(new RegExp("(^| )" + alias + "(?= |$)", "g"), "$1" + canonical);
  }
  if (/\b(?:iphone|galaxy)\b/.test(text)) text = text.replace(/\b(64|128|256|512|1024)(?= |$)(?!\s+(?:gb|tb)\b)/g, "$1gb");
  return text.replace(/(^| )(?:ابغي|ابي|اريد|ابحث|عن|لي|بافضل|افضل|ارخص|سعر|اشتري|please|find)(?= |$)/g, " ")
    .replace(/\b(iphone|airpods|ps)\s*(\d+)/g, "$1 $2")
    .replace(/\bplaystation\s+(\d+)\b/g, "ps $1")
    .replace(/\bps\s+(\d+)\b/g, "ps$1")
    .replace(/\b(\d+)\s+(gb|tb|mb|mah|mp)\b/g, "$1$2")
    .replace(/\s+/g, " ").trim();
}

export function parseSearchIntent(value = "") {
  const normalizedQuery = normalizeSearchQuery(value);
  const condition = normalizedQuery.match(/\b(refurbished|used|new)\b/)?.[1] || null;
  return {
    normalizedQuery,
    providerQuery: normalizedQuery.replace(/\b(refurbished|used|new)\b/g, "").replace(/\s+/g," ").trim(),
    model: normalizedQuery.match(/\b(?:iphone (?:air|\d+)(?: pro(?: max)?| plus)?|galaxy s\d+(?: ultra| plus| fe)?|ps\d+(?: slim| pro)?|airpods(?: pro)?(?: \d+)?|dyson v\d+)\b/)?.[0] || null,
    storage: normalizedQuery.match(/\b\d+(?:gb|tb)\b/)?.[0] || null,
    color: normalizedQuery.match(/\b(?:mist blue|desert titanium|natural titanium|black titanium|white titanium|cosmic orange|deep blue|black|white|lavender|sage|silver|gold|blue|green)\b/)?.[0] || null,
    condition,
  };
}

const ACCESSORY_TERMS = [
  "case","cover","screen protector","protector","charger","cable","adapter",
  "حافظه","كفر","شاحن","كيبل","سلك","حمايه","لزقه"
];

const UNREQUESTED_VARIANT_TERMS = [
  "pro","max","plus","ultra","air","fold","flip","fe",
  "برو","ماكس","بلس","الترا","اير"
];

export function assessOfferMatch(query, offer) {
  const intent = parseSearchIntent(query);
  const normalizedQuery = intent.providerQuery;
  const q = normalizedQuery.split(" ").filter(Boolean);
  const title = normalizeSearchQuery([offer?.title, offer?.specs?.storage, offer?.specs?.color].filter(Boolean).join(" "));
  if (!q.length || !title) return { exactMatch: false, matchConfidence: 0 };

  const titleTokens = new Set(title.split(" ").filter(Boolean));
  const hits = q.filter((token) => titleTokens.has(token)).length;
  let confidence = hits / q.length;

  const hasPhrase = (text, term) => (" " + text + " ").includes(" " + normalizeSearchQuery(term) + " ");
  const queryHasAccessoryIntent = ACCESSORY_TERMS.some((term) => hasPhrase(normalizedQuery, term));
  const titleHasAccessory = ACCESSORY_TERMS.some((term) => hasPhrase(title, term));
  if (!queryHasAccessoryIntent && titleHasAccessory) confidence *= 0.35;

  const queryTokens = new Set(q);
  const hasUnrequestedVariant = UNREQUESTED_VARIANT_TERMS.some(
    (term) => titleTokens.has(term) && !queryTokens.has(term)
  );
  if (hasUnrequestedVariant) confidence *= 0.82;

  const conditionMismatch = intent.condition ? offer?.condition !== intent.condition : offer?.condition && offer.condition !== "new";
  if (conditionMismatch) confidence -= 0.15;
  confidence = Math.max(0, Math.min(1, confidence));

  const missingTerms = q.filter((token) => !titleTokens.has(token));
  const exactMatch = confidence >= 0.92 && hits === q.length &&
      !(!queryHasAccessoryIntent && titleHasAccessory) &&
      !hasUnrequestedVariant && !conditionMismatch;
  return {
    exactMatch,
    matchConfidence: Math.round(confidence * 100) / 100,
    missingTerms,
    matchReason: exactMatch ? "يطابق مواصفات بحثك" : conditionMismatch ? "حالة المنتج تختلف عن المطلوب" :
      !queryHasAccessoryIntent && titleHasAccessory ? "ملحق للمنتج، وليس الجهاز المطلوب" :
      hasUnrequestedVariant ? "نسخة مختلفة عن الموديل المطلوب" : "بعض مواصفات البحث غير موجودة في بيانات العرض",
  };
}

export function buildComparisonQuery(offer = {}) {
  const specs = offer.specs || {};
  const title = normalizeSearchQuery(String(offer.title || "").split("|")[0]);
  const knownModel = title.match(/\biphone (?:air|\d+)(?: pro(?: max)?| plus| air)?\b/)?.[0];
  const model = normalizeSearchQuery(specs.deviceType || specs.series || knownModel || "");
  const storage = normalizeSearchQuery(specs.storage || title.match(/\b\d+(?:gb|tb)\b/)?.[0] || "");
  const color = normalizeSearchQuery(specs.color || title.match(/\b(?:mist blue|desert titanium|natural titanium|black titanium|white titanium|cosmic orange|deep blue|black|white|lavender|sage|silver|gold|blue|green)\b/)?.[0] || "");
  return (model ? [model, storage, color].filter(Boolean).join(" ") : title).slice(0, 180).trim();
}

function comparisonUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|campaign|gclid|fbclid|gad_|gbraid|wbraid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return String(value || ""); }
}

export function mergeComparisonOffers(source, candidates = []) {
  const query = buildComparisonQuery(source);
  const normalizeSku = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const sku = normalizeSku(source.specs?.modelNumber);
  const seen = new Set([comparisonUrl(source.sourceUrl)]);
  const offers = [{ ...source, exactMatch: true, matchConfidence: 1 }];
  for (const offer of candidates) {
    const url = comparisonUrl(offer.sourceUrl);
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    const match = assessOfferMatch(query, offer);
    const candidateSku = normalizeSku(offer.specs?.modelNumber);
    const conflictingSku = sku && candidateSku && sku !== candidateSku;
    const conflictingCondition = source.condition !== offer.condition;
    offers.push({ ...offer, ...match,
      exactMatch: match.exactMatch && !conflictingSku && !conflictingCondition,
      matchConfidence: conflictingSku || conflictingCondition ? Math.min(match.matchConfidence, 0.69) : match.matchConfidence,
    });
  }
  return offers;
}
