// Offline/diagnostic extractor for the first-party Noon Saudi search results
// HTML captured in a Safari WebArchive. Never feeds customer-facing offers.
// In particular, advertised PLP prices do not certify PDP buybox or checkout.
import {load} from "cheerio";
import {noonSaudiProductIdentity} from "./noon-sa-catalog.mjs";
import {normalizeSearchQuery} from "./search-query.mjs";

const MAX_HTML=8_000_000;
const MAX_CARDS=100;
const PRICE=/^\d{1,8}(?:\.\d{1,2})?$/;
const OFFER_CODE=/^[a-z0-9-]{1,100}$/i;

function sourceImage(raw) {
  try {
    const url=new URL(raw);
    return url.protocol==="https:" && url.hostname==="f.nooncdn.com" &&
      url.pathname.startsWith("/p/") ? url.href : null;
  } catch {return null;}
}

function canonicalOfferUrl(productUrl,offerCode) {
  return productUrl+(offerCode ? "?o="+encodeURIComponent(offerCode) : "");
}

function cardUrlInfo(raw) {
  try {
    const url=new URL(raw,"https://www.noon.com");
    const identity=noonSaudiProductIdentity(url.href);
    if(!identity || url.pathname!==new URL(identity.canonicalUrl).pathname)return null;
    const rawOffer=url.searchParams.getAll("o");
    const offerCode=rawOffer.length===1 && OFFER_CODE.test(rawOffer[0])
      ? rawOffer[0] : null;
    return {...identity,offerCode,offerUrl:canonicalOfferUrl(identity.canonicalUrl,offerCode)};
  } catch {return null;}
}

function cardPrice(text) {
  const raw=String(text||"").replace(/[\uE000,\s]/g,"");
  if(!PRICE.test(raw))return null;
  const value=Number(raw);
  return Number.isFinite(value)&&value>0?value:null;
}

export function extractNoonSaudiSearchCardEvidence(html, query, {limit=100}={}) {
  if(typeof html!=="string" || html.length>MAX_HTML || html.length===0)
    return {status:"INVALID_HTML",heading:null,rawLinks:0,parsedCards:0,candidates:[],conflicts:[]};
  const $=load(html);
  const heading=$("h1").first().text().trim();
  const expected=normalizeSearchQuery(query||"");
  const observed=normalizeSearchQuery(heading);
  // An HTTP 200 shell or the homepage must not be classified as search data.
  if(!expected || !observed || expected!==observed)
    return {status:"SEARCH_CONTEXT_NOT_ATTESTED",heading,rawLinks:0,parsedCards:0,candidates:[],conflicts:[]};

  const rawCards=[];
  let rawLinks=0;
  $('a[href*="/p/"]').each((_,a)=>{
    if(rawLinks>=1000 || rawCards.length>=MAX_CARDS)return false;
    rawLinks++;
    const link=$(a);
    const url=cardUrlInfo(link.attr("href"));
    if(!url)return;
    const title=link.find('[data-qa="plp-product-box-name"]').first().text().trim();
    const sellingPriceNode=link.find('[data-qa="plp-product-box-price"] strong[class*="amount"]').first();
    if(!sellingPriceNode.length || title.length<4 || title.length>350)return;
    const price=cardPrice(sellingPriceNode.text());
    if(price===null)return;
    let image=null;
    link.find("img[src]").each((__,img)=>{
      image=sourceImage($(img).attr("src"));
      if(image)return false;
    });
    if(!image)return;
    rawCards.push({
      productId:url.sku, offerCode:url.offerCode, sourceUrl:url.canonicalUrl,
      offerUrl:url.offerUrl, title, image, price, currency:"SAR",
      priceEvidence:"SAVED_SEARCH_CARD_DISPLAYED",
      customerPublishable:false,
    });
  });

  const byKey=new Map();
  for(const item of rawCards) {
    const key=item.productId+"|"+(item.offerCode||"");
    if(!byKey.has(key))byKey.set(key,[]);
    byKey.get(key).push(item);
  }
  const conflicts=[],candidates=[];
  for(const [key,records] of byKey) {
    const prices=[...new Set(records.map(r=>r.price))].sort((a,b)=>a-b);
    if(prices.length>1) {
      conflicts.push({productId:records[0].productId,offerCode:records[0].offerCode,observedPrices:prices});
    } else {
      candidates.push(records[0]);
    }
  }
  const cap=Math.min(MAX_CARDS,Math.max(0,Math.floor(Number(limit)||0)));
  return {status:candidates.length?"SEARCH_CARD_EVIDENCE":"NO_ELIGIBLE_SEARCH_CARDS",
    heading,rawLinks,parsedCards:rawCards.length,
    candidates:candidates.slice(0,cap),conflicts};
}
