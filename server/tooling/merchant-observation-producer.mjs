// Pilot producer for merchant-original JSON-LD evidence. No public API entrypoint,
// no automatic crawling, and no database writes until explicitly queued.
import {extractProductDocument} from "../url-resolver.mjs";
import {validateCandidateOffer} from "./offer-schema.mjs";
import {issueSourceAttestation} from "./source-attestation.mjs";
import {enqueueVerifiedOffer} from "./offer-ingestion-worker.mjs";
import {CERTIFIED_SOURCE_HOSTS} from "../../src/certified-source-hosts.mjs";

// Deliberately smaller than the certified 15: admission to the earlier pilot
// is NOT permission to write live observations for all 15 merchants.
export const LIVE_PRODUCER_SOURCES=Object.freeze({
 "ikea-sa":Object.freeze({host:"ikea.com",currency:"SAR",merchant:"IKEA"})
});
function checkedProductUrl(sourceId,raw){
 const config=LIVE_PRODUCER_SOURCES[sourceId];
 if(!config)throw new Error("source_not_live_enabled");
 let u;
 try{u=new URL(raw);}catch{throw new Error("invalid_product_url");}
 const host=u.hostname.toLowerCase().replace(/\.$/,"");
 if(u.protocol!=="https:"||u.username||u.password||u.port||
    ![config.host,"www."+config.host].includes(host)||
    u.search||u.hash||!/^\/sa\/(?:en|ar)\/p\/[^/?#]+\/?$/i.test(u.pathname))
   throw new Error("unapproved_product_url");
 return {url:u,config};
}
function sameProductPage(first,second){
 const a=new URL(first),b=new URL(second);
 return a.pathname.replace(/\/+$/,"")===b.pathname.replace(/\/+$/,"") &&
   a.search===b.search;
}
function expectedIkeaSku(url){
 const slug=new URL(url).pathname.split("/").filter(Boolean).at(-1)||"";
 const match=/(?:^|-)(?:s)?(\d{8})$/i.exec(slug);
 return match?.[1]||null;
}
function normalizedIkeaSku(sku){
 return typeof sku==="string"?sku.replace(/\D/g,""):null;
}
function strictPrice(value){
 if(typeof value==="number")return Number.isFinite(value)&&value>0&&value<=250000?value:null;
 if(typeof value!=="string"||!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value.trim()))return null;
 const number=Number(value.trim().replace(/,/g,""));
 return Number.isFinite(number)&&number>0&&number<=250000?number:null;
}
function matchingProductTitle(expected,candidate){
 if(typeof candidate!=="string")return false;
 const tokens=v=>new Set((String(v).normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)||[])
   .filter(word=>word.length>2&&word!=="ikea"));
 const a=tokens(expected),b=tokens(candidate);
 if(a.size<2)return false;
 const shared=[...a].filter(word=>b.has(word)).length;
 return shared>=2&&shared/a.size>=0.7;
}
function approvedImage(raw,base){
 const value=Array.isArray(raw)?raw[0]:raw;
 const candidate=typeof value==="string"?value:value?.url;
 if(!candidate)return undefined;
 try{
  const url=new URL(candidate,base);
  if(url.protocol!=="https:"||url.username||url.password||url.port||!["ikea.com","www.ikea.com"].includes(url.hostname.toLowerCase()))
   return undefined;
  return url.href;
 }catch{return undefined;}
}
export async function extractCertifiedMerchantOffer({sourceId,url,extract=extractProductDocument,clock=Date.now}={}){
 const requested=checkedProductUrl(sourceId,url);
 if(typeof extract!=="function")throw new TypeError("extractor_required");
 const document=await extract(requested.url.href);
 const final=checkedProductUrl(sourceId,document?.finalUrl);
 if(!sameProductPage(requested.url.href,final.url.href))throw new Error("merchant_redirect_changed_product");
 const products=(document?.candidates||[]).filter(x=>x?.strategy==="jsonld"&&x.product);
 if(products.length!==1)throw new Error("unique_original_product_evidence_required");
 const product=products[0].product;
 if(!product||typeof product!=="object"||Array.isArray(product))throw new Error("invalid_original_product");
 const raw=product.offers;
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||raw["@type"]==="AggregateOffer")
  throw new Error("ambiguous_merchant_offer");
 if(raw.url){
  let offerUrl;
  try{offerUrl=new URL(raw.url,final.url);}catch{throw new Error("merchant_offer_url_mismatch");}
  checkedProductUrl(sourceId,offerUrl.href);
  if(!sameProductPage(final.url.href,offerUrl.href))throw new Error("merchant_offer_url_mismatch");
 }
 const price=strictPrice(raw.price);
 if(price===null)throw new Error("unverified_original_price");
 if(raw.priceCurrency!==requested.config.currency)throw new Error("merchant_market_currency_mismatch");
 const sku=typeof product.sku==="string"?product.sku.trim():"";
 const expectedSku=expectedIkeaSku(final.url.href);
 if(!expectedSku||normalizedIkeaSku(sku)!==expectedSku)
  throw new Error("original_product_sku_mismatch");
 const title=typeof product.name==="string"?product.name.trim().replace(/\s+/g," "):"";
 const metadata=(document.candidates||[]).find(entry=>entry?.strategy==="meta")?.product;
 const metadataMatches=matchingProductTitle(title,metadata?.name);
 const metadataPrice=metadataMatches?metadata?.offers?.price:null;
 const metadataCurrency=metadataMatches?metadata?.offers?.priceCurrency:null;
 // Contradictory independently parsed merchant metadata must fail closed.
 if(metadataPrice!=null&&metadataCurrency!=null){
  const crossPrice=strictPrice(metadataPrice);
  if(crossPrice===null||crossPrice!==price||metadataCurrency!==requested.config.currency)
   throw new Error("original_price_evidence_disagreement");
 }
 const jsonLdImage=approvedImage(product.image,final.url.href);
 const metaImage=metadataMatches?approvedImage(metadata?.image,final.url.href):undefined;
 const image=jsonLdImage||metaImage;
 const imageSource=jsonLdImage?"jsonld":metaImage?"matching_page_metadata":"missing";
 const offer={
  title,sourceUrl:final.url.href,productPrice:price,currency:requested.config.currency,
  merchant:requested.config.merchant,
  ...(image?{imageUrl:image}:{}),
  ...(sku.length<=120?{sku}:{})
 };
 if(!validateCandidateOffer(offer).valid)throw new Error("invalid_original_merchant_offer");
 const when=clock();
 if(!Number.isSafeInteger(when)||when<0)throw new Error("invalid_observation_time");
 return {offer,evidence:{
  sourceId,extractionStrategy:"jsonld",verifiedPage:final.url.href,
  observedAt:new Date(when).toISOString(),hasImage:Boolean(image),imageSource,
  imageLoadVerified:false,hasSku:Boolean(offer.sku),
  priceCrossCheck:metadataPrice!=null&&metadataCurrency!=null?"matched":"unavailable",
  merchantPriceVerified:true
 }};
}
export async function enqueueCertifiedMerchantProduct(boss,{sourceId,url,key,extract=extractProductDocument,clock=Date.now}={}){
 if(!boss||typeof boss.send!=="function")throw new Error("queue_not_started");
 // Validate secret before any network call, never accept a client-provided price.
 if(typeof key!=="string"||Buffer.byteLength(key,"utf8")<32)throw new Error("source_signing_key_required");
 const extracted=await extractCertifiedMerchantOffer({sourceId,url,extract,clock});
 const attestation=issueSourceAttestation({
  sourceId,offer:extracted.offer,sourceHosts:CERTIFIED_SOURCE_HOSTS,key,clock
 });
 const jobId=await enqueueVerifiedOffer(boss,{sourceId,offer:extracted.offer,
  verifiedBySource:sourceId,attestation});
 return {jobId,queued:jobId!==null&&jobId!==undefined,evidence:extracted.evidence};
}
