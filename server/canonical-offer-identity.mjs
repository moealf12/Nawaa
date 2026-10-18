import {createHash} from "node:crypto";

// v16.1 isolated canonical identity contract. Product IDs and market identity
// are part of the offer key; price, availability and observation time are NOT.
export function canonicalOfferUrl(value){
  try{
    const url=new URL(String(value||"").trim());
    if(url.protocol!=="https:"||url.username||url.password||!url.hostname)return null;
    url.hash="";
    url.hostname=url.hostname.toLowerCase().replace(/^www\./,"");
    url.pathname=url.pathname.replace(/\/+$/,"")||"/";
    for(const key of [...url.searchParams.keys()])
      if(/^utm_|^(gclid|fbclid|ref|aff|affiliate)$/i.test(key))
        url.searchParams.delete(key);
    return url.toString();
  }catch{return null;}
}

export function canonicalOfferIdentity(offer){
  const url=canonicalOfferUrl(offer?.sourceUrl);
  if(!url)return null;
  const condition=String(offer.condition||"new").trim().toLowerCase()||"new";
  const country=String(offer.merchantCountryCode||"").trim().toUpperCase();
  const physicalSku=String(offer.sourceMeta?.productId||offer.sku||"").trim();
  const mpn=String(offer.specs?.modelNumber||"").trim().toUpperCase();
  // Typed serialization prevents delimiter collisions; missing SKU is allowed.
  const fields=[url,condition,country,physicalSku,mpn];
  const offerKey=JSON.stringify(fields);
  const documentId=createHash("sha256").update(offerKey).digest("hex");
  return {offerKey,documentId,sourceUrl:url,condition,physicalSku,mpn};
}

export function canonicalOfferPayload(offer){
  const identity=canonicalOfferIdentity(offer);
  if(!identity)return null;
  const observedTime=typeof offer.observedAt==="string"&&offer.observedAt.trim()
    ? Date.parse(offer.observedAt):NaN;
  const price=Number(offer.productPrice);
  const currency=String(offer.currency||"").trim().toUpperCase();
  if(!Number.isFinite(observedTime)||observedTime>Date.now()+60_000||
     !Number.isFinite(price)||price<=0||!/^[A-Z]{3}$/.test(currency)||
     String(offer.title||"").trim().length<3)return null;
  const canonical={
    ...offer,
    sourceUrl:identity.sourceUrl,
    condition:identity.condition,
    productPrice:price,
    currency,
    observedAt:new Date(observedTime).toISOString(),
    exactMatch:false,
    matchConfidence:0
  };
  // Fingerprint reflects source evidence, not stored query-specific ranking.
  const evidence={
    sourceUrl:canonical.sourceUrl,
    productPrice:canonical.productPrice,
    currency:canonical.currency,
    availability:canonical.availability??null,
    title:canonical.title,
    observedAt:canonical.observedAt,
    sku:identity.physicalSku,
    mpn:identity.mpn
  };
  const fingerprint=createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  return {...identity,offer:canonical,fingerprint};
}
