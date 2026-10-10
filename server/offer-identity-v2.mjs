import {createHash} from 'node:crypto';

// Pure, opt-in identity contract. No schema migration or live search integration.
// An ambiguous listing must never be coerced to one shared canonical offer.
const norm = value => String(value ?? '').trim().toLowerCase().normalize('NFKC').replace(/\s+/g,' ');
const meaningful = value => typeof value === 'string' && value.trim().length > 0;
const validIdentifier = value => meaningful(value) && norm(value).length <= 180;
function stableHttpsUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('invalid_offer_url'); }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) throw new Error('invalid_offer_url');
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) if (/^utm_|^(gclid|fbclid|ref|aff|affiliate)$/i.test(key)) u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  u.searchParams.sort();
  return u.href;
}
function digest(fields) { return createHash('sha256').update(JSON.stringify(fields)).digest('hex'); }

/**
 * Source-scoped identity; never includes price, observation time, or listing title.
 * Separate product variants require independently grounded variant IDs.
 * Unknown variants are NOT silently grouped by URL.
 */
export function deriveOfferIdentityV2({
  sourceId, sourceUrl, sourceListingId, sourceVariantId, sku, condition='new',
  variantRequired=false,
}={}) {
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(String(sourceId||''))) throw new Error('invalid_source_id');
  const url = stableHttpsUrl(sourceUrl);
  const listing = validIdentifier(sourceListingId) ? ['listing',norm(sourceListingId)] : ['url',url];
  const variant = validIdentifier(sourceVariantId)
    ? ['source_variant',norm(sourceVariantId)]
    : validIdentifier(sku)
      ? ['source_sku',norm(sku)]
      : null;
  if (variantRequired && !variant) throw new Error('unresolved_variant_identity');
  if (!variant) throw new Error('missing_variant_disambiguator');
  const c = norm(condition);
  if (!/^(new|used|refurbished|open_box)$/.test(c)) throw new Error('invalid_condition');
  return {
    identityVersion:2,
    offerKey:'v2:'+digest([sourceId,listing,variant,c]),
    listingKey:'v2:'+digest([sourceId,listing]),
    variantEvidence:variant[0],
    sourceUrl:url,
    sourceId,
    condition:c,
  };
}
