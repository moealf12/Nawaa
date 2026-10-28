// Phase H.2 — zero-network, evidence-only classifier for Amazon Germany HTML.
// Classifies observation shape, NOT merchant inventory/availability or cause of denial.
// Never persist raw HTML, product URLs, cookies, tokens or ASIN values.
export function diagnoseAmazonGermanyHtml(html,{extractedCards=0}={}){
  const source=typeof html==="string"?html:"";
  const count=regex=>Math.min(10000,[...source.matchAll(regex)].length);
  const asinMarkers=count(/\bdata-asin\s*=\s*["'][A-Z0-9]{10}["']/gi);
  const priceMarkers=count(/\ba-offscreen\b/gi);
  const extracted=Math.min(10000,Math.max(0,Math.floor(Number(extractedCards)||0)));
  // Only exact page-level interstitial wording, and only without product cards.
  // An ordinary product titled "robot check" cannot trigger this class.
  const challenge=asinMarkers===0 &&
    /(?:<title[^>]*>\s*(?:robot\s*check|captcha)\s*<\/title>|\/errors\/validatecaptcha|enter the characters you see below)/i.test(source);
  const classification=!source?"HTML_NOT_OBSERVED":
    challenge?"CHALLENGE_PAGE_SUSPECTED":
    asinMarkers===0?"NO_ASIN_MARKERS":
    extracted>0?"EXTRACTED_PRICED_CARDS":
    priceMarkers===0?"ASIN_MARKERS_WITHOUT_PRICE_MARKERS":
    "ASIN_MARKERS_WITH_UNEXTRACTED_PRICES";
  return Object.freeze({
    classification,asinMarkers,priceMarkers,extractedCards:extracted,
    merchantInventoryVerified:false,merchantAccessCauseVerified:false,
  });
}
