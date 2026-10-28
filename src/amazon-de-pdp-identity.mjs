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


// An exact ASIN in generic page text is only a weak signal. For a seller price,
// require ONE first-party JSON-LD Product whose own URL and linked Offer URL
// both identify the same requested ASIN, a single EUR price, and a declared
// seller. This is same-source structured evidence, NEVER independent merchant
// attestation, buyer-visible buybox parity, or Saudi checkout verification.
function asinAtAmazonDeUrl(raw, base) {
  try {
    const u=new URL(raw,base);
    if(u.protocol!=="https:"||u.username||u.password||
      (u.port&&u.port!=="443")||
      !["amazon.de","www.amazon.de"].includes(u.hostname.toLowerCase()))return null;
    return /^\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i.exec(u.pathname)?.[1]?.toUpperCase()||null;
  }catch{return null}
}
const hasType=(node,type)=>{
  const list=Array.isArray(node?.["@type"])?node["@type"]:[node?.["@type"]];
  return list.some(x=>typeof x==="string" && x.toLowerCase().replace(/\/$/,"").split(/[\/#]/).pop()===type.toLowerCase());
};
function euroPrice(raw) {
  if(typeof raw!=="number" && typeof raw!=="string")return null;
  const value=String(raw).trim();
  if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(value))return null;
  const price=Number(value);
  return Number.isFinite(price)&&price>0?price:null;
}
const safeImage=(image)=>{
  const candidate=Array.isArray(image)?image[0]:image;
  const raw=typeof candidate==="string"?candidate:candidate?.url;
  try{
    const u=new URL(raw);
    return u.protocol==="https:" &&
      (u.hostname==="m.media-amazon.com" ||
       u.hostname==="images-na.ssl-images-amazon.com" ||
       u.hostname.endsWith(".media-amazon.com"))?u.href:null;
  }catch{return null}
};
function sourceProductNodes(html) {
  const out=[];
  let count=0;
  for(const match of String(html||"").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if(++count>60 || out.length>80)break;
    if(!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1]))continue;
    const raw=match[2].trim();
    if(!raw || raw.length>200000)continue;
    let payload;
    try{payload=JSON.parse(raw)}catch{continue}
    const nodes=Array.isArray(payload)?payload:[payload];
    for(const node of nodes.slice(0,40)) {
      if(node && typeof node==="object"){
        if(Array.isArray(node["@graph"]))out.push(...node["@graph"].slice(0,40));
        out.push(node);
      }
      if(out.length>80)break;
    }
  }
  return out;
}
export function extractAmazonDeScopedOffer(html, rawUrl) {
  const observed=inspectAmazonDePdpHtml(html,rawUrl);
  if(!observed)return null; // No change to any other retailer or URL form.
  const reject=status=>({
    status,expectedAsin:observed.expectedAsin,product:null,
    buyerVisiblePriceParity:false,sellerIndependentlyVerified:false,
    saudiCheckoutVerified:false,
  });
  if(observed.status==="PDP_ASIN_NOT_OBSERVED")return reject("PDP_ASIN_NOT_OBSERVED");
  const asin=observed.expectedAsin;
  const subjects=sourceProductNodes(html).filter(node=>
    node && typeof node==="object" && !Array.isArray(node) &&
    hasType(node,"Product") &&
    asinAtAmazonDeUrl(node.url,rawUrl)===asin);
  if(subjects.length!==1)return reject("UNAMBIGUOUS_ASIN_PRODUCT_NOT_FOUND");
  const product=subjects[0];
  for(const field of ["sku","asin","productID"]) {
    if(product[field]!==undefined && product[field]!==null &&
      (typeof product[field]!=="string" || product[field].trim().toUpperCase()!==asin))
      return reject("PRODUCT_ASIN_CONFLICT");
  }
  if(typeof product.name!=="string" || product.name.trim().length<3 ||
      product.name.length>240)return reject("PRODUCT_TITLE_UNVERIFIED");
  const offers=Array.isArray(product.offers)?product.offers:[product.offers];
  if(offers.length!==1 || !offers[0] || typeof offers[0]!=="object" ||
     !hasType(offers[0],"Offer") || hasType(offers[0],"AggregateOffer"))
    return reject("UNIQUE_OFFER_NOT_OBSERVED");
  const offer=offers[0];
  if(asinAtAmazonDeUrl(offer.url,rawUrl)!==asin ||
    (offer.sku!=null && (typeof offer.sku!=="string"||offer.sku.trim().toUpperCase()!==asin)))
    return reject("OFFER_ASIN_CONFLICT");
  // Never use lowPrice/priceRange/list price or incomplete price specifications.
  if(offer.lowPrice!=null || offer.highPrice!=null ||
     offer.priceSpecification!=null)return reject("AMBIGUOUS_OFFER_PRICE");
  const price=euroPrice(offer.price);
  if(price===null || offer.priceCurrency!=="EUR")
    return reject("EUR_PRICE_NOT_ATTESTED");
  const sellerName=offer.seller?.name;
  if(typeof sellerName!=="string"||sellerName.trim().length<2||
     sellerName.length>120)return reject("SELLER_NOT_DECLARED");
  const title=product.name.trim();
  const seller=sellerName.trim();
  return {
    status:"SOURCE_DECLARED_SAME_ASIN_OFFER_NOT_ATTESTED",
    expectedAsin:asin,buyerVisiblePriceParity:false,
    sellerIndependentlyVerified:false,saudiCheckoutVerified:false,
    product:{
      name:title,sku:asin,image:safeImage(product.image),
      brand:typeof product.brand==="string"?product.brand:
        (typeof product.brand?.name==="string"?product.brand.name:null),
      sourceDeclaredSeller:seller,
      amazonDeOfferEvidence:"SOURCE_DECLARED_SAME_ASIN_OFFER_NOT_ATTESTED",
      offers:{
        "@type":"Offer",price,priceCurrency:"EUR",
        url:"https://www.amazon.de/dp/"+asin,
        availability:typeof offer.availability==="string"?offer.availability:"",
      },
    },
  };
}


// Marketplace host/country do not prove seller location.
// A seller name found in the Amazon offer is declared, not independently verified.
export function amazonDeDeclaredSellerAttribution(product) {
  if(product?.amazonDeOfferEvidence!=="SOURCE_DECLARED_SAME_ASIN_OFFER_NOT_ATTESTED"||
     typeof product.sourceDeclaredSeller!=="string"||
     !product.sourceDeclaredSeller.trim())return null;
  return {
    sellerName:product.sourceDeclaredSeller.trim(),
    sellerCountryCode:"UN",sellerCountryNameAr:"غير معروف",
    sellerIndependentlyVerified:false,marketplace:"Amazon Germany",
  };
}
