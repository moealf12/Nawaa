// v21.57 product-card image ownership boundary.
// A neighboring merchant offer is not evidence that its image belongs to the
// chosen sellable item, even when entity grouping considers them comparable.
// Missing source-owned images intentionally yield a truthful fallback.
export function ownOfferImages(offer) {
  const value=offer?.image;
  if(typeof value!=='string'||!value.trim())return [];
  const image=value.trim();
  try {
    const url=new URL(image);
    if(!['https:','http:'].includes(url.protocol)||!url.hostname||
       url.username||url.password)return [];
    return [image];
  }catch{return [];}
}
