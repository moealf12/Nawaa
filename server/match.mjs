import { normalizeSearchQuery } from "../src/search-query.mjs";
import { canonicalOfferUrl } from "./canonical-offer-identity.mjs";
export { assessOfferMatch } from "../src/search-query.mjs";
export const normalizeSearchText = normalizeSearchQuery;

// Source observation time selects the current record; its price is not part
// of sellable-product identity. A newer live observation can replace a
// persisted replay without manufacturing a new price or observation time.
function preferIncomingObservation(previous, incoming) {
  const a=typeof previous?.observedAt==="string"?Date.parse(previous.observedAt):NaN;
  const b=typeof incoming?.observedAt==="string"?Date.parse(incoming.observedAt):NaN;
  if(Number.isFinite(b)&&(!Number.isFinite(a)||b>a))return true;
  return Number.isFinite(a)&&b===a&&
    incoming.dataKind==="live"&&previous.dataKind!=="live";
}

export function dedupeNormalizedOffers(offers = []) {
  const positions = new Map();
  const out = [];
  for (const offer of offers) {
    if(!offer||typeof offer!=="object")continue;
    // A shared listing URL must not merge independently sellable SKUs,
    // models, markets or conditions. Cross-store URLs stay separate.
    const country=String(offer.merchantCountryCode||"").toUpperCase();
    const physicalSku=String(offer.sourceMeta?.productId||offer.sku||"").trim();
    const model=String(offer.specs?.modelNumber||offer.mpn||"").trim().toUpperCase();
    const condition=String(offer.condition||"new").trim().toLowerCase();
    const seller=String(offer.seller?.name||offer.merchant||"").trim();
    const stableListingId=String(offer.sourceListingId||"").trim();
    const identity=[offer.provider,country,condition,physicalSku,model,seller];
    const key=stableListingId
      ? normalizeSearchText([...identity,"listing",stableListingId].join("|"))
      : normalizeSearchText([
          ...identity,
          canonicalOfferUrl(offer.sourceUrl)||offer.sourceUrl,
          offer.title,
          // Currency/market are identity boundaries; the observed PRICE is not.
          offer.originalCurrency||offer.currency,
        ].join("|"));
    if(!key)continue;
    const index=positions.get(key);
    if(index===undefined){
      positions.set(key,out.length);
      out.push(offer);
    }else if(preferIncomingObservation(out[index],offer)){
      // Preserve the first occurrence's stable ranking position.
      out[index]=offer;
    }
  }
  return out;
}
