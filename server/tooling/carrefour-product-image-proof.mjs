// Isolated, no-network, fail-closed Carrefour UAE product-image corroboration.
// Every accepted image must come from official merchant structured metadata
// for the exact PDP id, equivalent product title and identical observed AED price.
// This module is NOT imported by customer search or used to enable a source.
import {load} from "cheerio";
import {carrefourPdpId} from "./carrefour-image-evidence.mjs";
const IMAGE_HOSTS=["cdn.mafrservices.com","cdnprod.mafretailproxy.com","www.carrefouruae.com"];
const LIMIT=8_000_000;
function safeOfficialImage(raw){
 if(typeof raw!=="string"||raw.length>1600)return null;
 try{
  const url=new URL(raw,"https://www.carrefouruae.com");
  const h=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||url.username||url.password||url.port||
    !(IMAGE_HOSTS.includes(h)||
      h.endsWith(".mafrservices.com")||h.endsWith(".mafretailproxy.com")||
      h.endsWith(".carrefouruae.com"))||
    /\.(?:svg|js|css|json)(?:$)/i.test(url.pathname))
   return null;
  return url.href;
 }catch{return null;}
}
function normalizeTitle(text){
 return String(text??"").normalize("NFKC").toLowerCase()
 .replace(/(\d+)\s*(gb|tb)\b/g,"$1 $2")
 .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function sameProductTitle(expected,observed){
 const a=new Set(normalizeTitle(expected).split(" ").filter(t=>t.length>=2));
 const b=new Set(normalizeTitle(observed).split(" ").filter(t=>t.length>=2));
 if(a.size<3||b.size<3)return false;
 const hits=[...a].filter(t=>b.has(t)).length;
 return hits>=3&&hits/a.size>=0.7&&hits/b.size>=0.6;
}
function priceCents(price){
 if(typeof price!=="string"&&typeof price!=="number")return null;
 const clean=String(price).replace(/,/g,"").trim();
 if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(clean))return null;
 const value=Number(clean);
 return value>0&&Number.isFinite(value)?Math.round(value*100):null;
}
function productsFromGraph(value,result=[],depth=0){
 if(depth>7||result.length>120||!value||typeof value!=="object")return result;
 if(Array.isArray(value)){
  for(const item of value.slice(0,120))productsFromGraph(item,result,depth+1);
  return result;
 }
 const type=value["@type"];
 if((Array.isArray(type)?type:[type]).some(x=>/^(?:https?:\/\/schema\.org\/)?product$/i.test(String(x))))
  result.push(value);
 if(value["@graph"])productsFromGraph(value["@graph"],result,depth+1);
 if(value.itemListElement)productsFromGraph(value.itemListElement,result,depth+1);
 if(value.item)productsFromGraph(value.item,result,depth+1);
 return result;
}
function matchingOffers(product,id,price,originalUrl){
 const candidates=Array.isArray(product.offers)?product.offers:[product.offers];
 const expected=new URL(originalUrl);
 return candidates.some(offer=>{
  if(!offer||typeof offer!=="object")return false;
  if(String(offer.priceCurrency).toUpperCase()!=="AED"||priceCents(offer.price??offer.lowPrice)!==price)return false;
  if(offer.url){
   const identity=carrefourPdpId(offer.url);
   if(identity!==id)return false;
   // A seller-specific offer link must not silently corroborate another seller.
   try{
    const actual=new URL(offer.url,expected);
    const offerCode=actual.searchParams.get("offer");
    const expectedCode=expected.searchParams.get("offer");
    if(offerCode&&expectedCode&&offerCode!==expectedCode)return false;
   }catch{return false;}
  }
  return true;
 });
}
export function proveCarrefourPdpImage(html,{sourceUrl,title,priceAED}={}){
 const id=carrefourPdpId(sourceUrl);
 const targetPrice=priceCents(priceAED);
 if(!id||typeof title!=="string"||!title.trim()||targetPrice===null)
  throw new Error("invalid_carrefour_image_proof_identity");
 if(typeof html!=="string"||html.length>LIMIT)throw new Error("invalid_carrefour_image_proof_document");
 const $=load(html);
 const blocks=$('script[type="application/ld+json"]').slice(0,30).toArray();
 const images=new Set(),failures={idMismatch:0,titleMismatch:0,priceMismatch:0,unsafeImage:0};
 for(const block of blocks){
  const body=$(block).html()||"";
  if(!body||body.length>1_000_000)continue;
  let json;
  try{json=JSON.parse(body)}catch{continue}
  for(const product of productsFromGraph(json)){
   if(carrefourPdpId(product.url)!==id){failures.idMismatch++;continue;}
   if(!sameProductTitle(title,product.name)){failures.titleMismatch++;continue;}
   if(!matchingOffers(product,id,targetPrice,sourceUrl)){failures.priceMismatch++;continue;}
   const imgs=Array.isArray(product.image)?product.image:[product.image];
   for(const item of imgs.slice(0,12)){
    const raw=typeof item==="string"?item:item?.url??item?.contentUrl;
    const candidate=safeOfficialImage(raw);
    if(candidate)images.add(candidate);else if(raw)failures.unsafeImage++;
   }
  }
 }
 if(images.size===1)return {verified:true,status:"product_id_title_aed_price_image_correlated",
  pdpId:id,imageUrl:[...images][0],imageSource:"same_product_json_ld",
  productionSourceActivated:false};
 return {verified:false,status:images.size>1?"ambiguous_product_images":"insufficient_merchant_image_evidence",
  pdpId:id,imageUrl:null,candidateImages:images.size,
  mismatches:failures,productionSourceActivated:false};
}
