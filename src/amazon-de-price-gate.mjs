// Amazon Germany is a source-evidence pilot, NOT a customer-priced source.
// An ASIN in a first-party JSON-LD Product/Offer does not independently prove
// the buybox selected for the shopper, its seller, variant or delivered price.
// Fail closed in BOTH generic URL resolution and free-storefront search.
// No caller-provided evidence flags may turn this policy into an approval.
export const AMAZON_DE_PUBLICATION_HOLD="BUYBOX_SAME_OFFER_PARITY_UNVERIFIED";

function amazonDeOfficialHost(url){
  try{
    const parsed=new URL(url);
    return parsed.protocol==="https:" && !parsed.username && !parsed.password &&
      (!parsed.port || parsed.port==="443") &&
      ["amazon.de","www.amazon.de"].includes(parsed.hostname.toLowerCase());
  }catch{return false}
}
export function amazonDeCustomerPriceDecision({sourceId=null,sourceUrl=null}={}){
  const held=sourceId==="amazon-de" || amazonDeOfficialHost(sourceUrl);
  return Object.freeze({
    customerPublishable:!held,
    ...(held?{status:AMAZON_DE_PUBLICATION_HOLD}:{}),
  });
}
// Offline-only structural comparison to inform future buybox validation.
// Matching two caller-provided records never proves either originated from a
// real merchant page, and NEVER grants customer publication or trust badges.
export function compareAmazonDeDeclaredVsBuybox(declared,buybox) {
  const reject=reason=>Object.freeze({
    structuralMatch:false,reason,customerPublishable:false,
    buyboxIndependentlyAttested:false,saudiShippingVerified:false,
  });
  const asin=String(declared?.sku||"").toUpperCase();
  if(!/^[A-Z0-9]{10}$/.test(asin))return reject("DECLARED_ASIN_MISSING");
  const desiredSeller=String(declared?.sourceDeclaredSeller||"").trim().normalize("NFKC");
  const expectedCents=Number(declared?.offers?.price);
  if(!desiredSeller || !Number.isSafeInteger(Math.round(expectedCents*100)) ||
     expectedCents<=0 || declared?.offers?.priceCurrency!=="EUR" ||
     declared?.amazonDeOfferEvidence!=="SOURCE_DECLARED_SAME_ASIN_OFFER_NOT_ATTESTED")
    return reject("DECLARED_OFFER_INCOMPLETE");
  if(String(buybox?.asin||"").toUpperCase()!==asin)return reject("BUYBOX_ASIN_CONFLICT");
  const observedSeller=String(buybox?.seller||"").trim().normalize("NFKC");
  if(observedSeller!==desiredSeller)return reject("BUYBOX_SELLER_CONFLICT");
  if(buybox?.currency!=="EUR" ||
     typeof buybox?.price!=="number" || !Number.isFinite(buybox.price) ||
     Math.round(buybox.price*100)!==Math.round(expectedCents*100))
    return reject("BUYBOX_PRICE_CONFLICT");
  return Object.freeze({
    structuralMatch:true,reason:"SYNTHETIC_SAME_OFFER_MATCH_NOT_ATTESTED",
    customerPublishable:false,buyboxIndependentlyAttested:false,
    saudiShippingVerified:false,
  });
}


// Customer read-side: includes previously indexed, cached and externally
// injected provider records. Neither asserted sourceMeta flags nor a claimed
// VERIFIED field can override this unpromoted Amazon DE pilot gate.
export function filterAmazonDeUnattestedCustomerOffers(offers=[]) {
  if(!Array.isArray(offers))return [];
  return offers.filter(offer=>amazonDeCustomerPriceDecision({
    sourceId:offer?.providerMarket,sourceUrl:offer?.sourceUrl,
  }).customerPublishable);
}
