// Read-only, zero-network identity-boundary evidence for Amazon Germany PDPs.
// An ASIN string in HTML is necessary but NOT sufficient to attest a price.
export function inspectAmazonDePdpHtml(html,rawUrl){
  let url;
  try{url=new URL(rawUrl)}catch{return null}
  if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443")||
    !["www.amazon.de","amazon.de"].includes(url.hostname.toLowerCase()))return null;
  const asin=/^\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i.exec(url.pathname)?.[1]?.toUpperCase();
  if(!asin)return null;
  const source=String(html||"");
  const observed=source.toUpperCase().includes(asin);
  // A marker may occur in a cross-sell, so it cannot certify identity/price.
  return {expectedAsin:asin,status:observed?"ASIN_MARKER_PRESENT_UNATTESTED":"PDP_ASIN_NOT_OBSERVED",
    requestedProductIdentityAttested:false,priceVerified:false,inventoryVerified:false};
}
