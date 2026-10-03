// Explicit variant requests need URL-level evidence before price reconciliation.
// Generic metadata must not supply the SKU/price/image of a cheaper sibling.
export function selectVariantCandidates(candidates, url) {
  const requested = new URL(url);
  if (!requested.searchParams.has('variant')) return candidates;
  const variant = requested.searchParams.get('variant');
  const path = value => value.pathname.replace(/\/+$/, '');
  const host = value => value.hostname.toLowerCase().replace(/^www\./, '');
  const result = [];
  for (const entry of candidates) {
    const product = entry.product;
    const raw = product?.offers;
    const offers = Array.isArray(raw) ? raw : Array.isArray(raw?.offers) ? raw.offers : raw ? [raw] : [];
    const matches = offers.filter(offer => {
      try {
        if (!offer?.url || !variant) return false;
        const candidate = new URL(offer.url, requested);
        return candidate.protocol === 'https:' && !candidate.username && !candidate.password && (!candidate.port || candidate.port === '443') && host(candidate) === host(requested) && path(candidate) === path(requested) && candidate.searchParams.get('variant') === variant;
      } catch { return false; }
    });
    // Ambiguous duplicate offers cannot establish which price is current.
    if (matches.length !== 1) continue;
    const offer = matches[0];
    const label = typeof offer.name === 'string' && offer.name !== 'Default Title' ? offer.name.trim() : '';
    result.push({...entry,product:{...product,
      name: label ? `${product.name} · ${label}` : product.name,
      sku: offer.sku || null,
      mpn: offer.mpn || (product.mpn !== product.sku ? product.mpn : null),
      color: offer.color || null,
      image: offer.image || (offers.length === 1 ? product.image : null),
      gtin: offer.gtin || null,gtin12:offer.gtin12 || null,gtin13:offer.gtin13 || null,gtin14:offer.gtin14 || null,
      variantId:variant,offers:offer,
    }});
  }
  if (!result.length) throw new Error('Requested product variant could not be verified');
  return result;
}
