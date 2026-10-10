// Zero-network staged proof for an already captured Carrefour UAE search page.
// Never changes customer offers; title, PDP id, AED price and official image
// must corroborate, and an independent PDP may veto contradictory images.
import {load} from "cheerio";
import {carrefourPdpId} from "./carrefour-image-evidence.mjs";
import {proveCarrefourPdpImage,safeOfficialImage,sameProductTitle} from "./carrefour-product-image-proof.mjs";
const MAX_HTML=8_000_000;
const IMAGE_ATTRS=["data-src","data-original","data-lazy-src","src","data-srcset","srcset"];
function priceCents(value){
 if(!["string","number"].includes(typeof value))return null;
 const raw=String(value).trim().replace(/,/g,"");
 if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(raw))return null;
 const price=Number(raw);
 return price>0&&Number.isFinite(price)?Math.round(price*100):null;
}
function validateOffer(offer){
 return offer&&typeof offer==="object"&&offer.providerMarket==="carrefour-ae"&&
  offer.image==null&&offer.originalCurrency==="AED"&&
  typeof offer.title==="string"&&offer.title.length>=5&&
  carrefourPdpId(offer.sourceUrl)!==null&&priceCents(offer.originalProductPrice)!==null;
}
function permittedImage($,node){
 for(const attribute of IMAGE_ATTRS){
  const raw=$(node).attr(attribute);
  if(!raw||raw.length>1600)continue;
  const first=raw.split(/\s*,\s*/)[0].split(/\s+/)[0];
  const image=safeOfficialImage(first);
  if(image)return image;
 }
 return null;
}
export function proveCarrefourSearchCardImage(html,offer){
 if(!validateOffer(offer))throw new Error("invalid_carrefour_card_offer");
 if(typeof html!=="string"||html.length>MAX_HTML)throw new Error("invalid_carrefour_card_html");
 const $=load(html),id=carrefourPdpId(offer.sourceUrl),price=priceCents(offer.originalProductPrice);
 const anchors=$("a[href]").filter((_,node)=>carrefourPdpId($(node).attr("href"))===id).slice(0,16).toArray();
 const images=new Set();let cardsWithPrice=0,ambiguous=0,priceConflicts=0;
 for(const anchor of anchors){
  if(!sameProductTitle(offer.title,$(anchor).text()))continue;
  let node=$(anchor);
  for(let level=0;level<5;level++){
   node=node.parent();
   if(!node.length||node.is("body")||node.is("html"))break;
   if((node.html()||"").length>32000)break;
   const ids=new Set();
   node.find("a[href]").each((_,el)=>{const item=carrefourPdpId($(el).attr("href"));if(item)ids.add(item);});
   if(ids.size!==1||!ids.has(id))break;
   // DOM text() can glue adjacent spans into "5GAED3,400". Preserve tag boundaries.
   const visibleText=(node.html()||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ");
   const prices=[...visibleText.matchAll(/\bAED\s*([\d,]+(?:\.\d{1,2})?)\b/gi)]
    .map(match=>priceCents(match[1])).filter(v=>v!==null);
   if(!prices.length)continue;
   if(prices.some(v=>v!==price)){priceConflicts++;continue;}
   cardsWithPrice++;
   const cardImages=new Set();
   node.find("img,source").slice(0,30).each((_,el)=>{
    const element=$(el),alt=element.attr("alt")||element.attr("title")||"";
    const explicit=element.attr("data-product-id")||element.attr("data-sku");
    if(explicit!==id&&!sameProductTitle(offer.title,alt))return;
    const image=permittedImage($,el);
    if(image)cardImages.add(image);
   });
   if(cardImages.size>1){ambiguous++;continue;}
   if(cardImages.size===1)images.add([...cardImages][0]);
  }
 }
 const accepted=images.size===1&&!ambiguous&&!priceConflicts;
 return {status:accepted?"corroborated_search_card_candidate":
  ambiguous||images.size>1?"ambiguous_search_images":
  priceConflicts?"card_price_conflict":"missing_card_image_evidence",
  proposedImageUrl:accepted?[...images][0]:null,
  matchingCards:cardsWithPrice,priceConflicts,ambiguousCards:ambiguous,
  verifiedByPdp:false,networkRequests:0,sourceOfferUnchanged:true};
}
export function reconcileCarrefourImageEvidence({offer,searchHtml,pdpHtml}={}){
 if(!validateOffer(offer))throw new Error("invalid_carrefour_reconciliation_offer");
 const card=typeof searchHtml==="string"?proveCarrefourSearchCardImage(searchHtml,offer):null;
 const product=typeof pdpHtml==="string"?proveCarrefourPdpImage(pdpHtml,{
  sourceUrl:offer.sourceUrl,title:offer.title,priceAED:offer.originalProductPrice
 }):null;
 const imageConflict=Boolean(card?.proposedImageUrl&&product?.verified&&
  card.proposedImageUrl!==product.imageUrl);
 // The captured search card can veto a PDP claim if the observed AED price
 // conflicts or its product-image identity was ambiguous.
 const evidenceConflict=Boolean(card?.priceConflicts||card?.ambiguousCards);
 const conflict=imageConflict||evidenceConflict;
 const verified=Boolean(product?.verified&&!conflict);
 return {status:conflict?"conflicting_merchant_images":
   verified?"eligible_for_separate_staging_review":
   card?.proposedImageUrl?"search_card_candidate_only":"insufficient_image_evidence",
  verified,proposedImageUrl:verified?product.imageUrl:null,
  cardStatus:card?.status??"not_supplied",
  pdpStatus:product?.status??"not_supplied",
  networkRequests:0,sourceOfferUnchanged:true,productionModified:false};
}
