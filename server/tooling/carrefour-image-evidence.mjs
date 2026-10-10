// Strictly read-only Carrefour UAE DOM image evidence explorer.
// Identifies image tags inside a DOM card that links to exactly ONE PDP id.
// Does not mutate offers, query routes, source status, price or live search.
import {load} from "cheerio";
const BASE="https://www.carrefouruae.com";
const PRODUCT_ID=/\/mafuae\/en\/[^?#]*\/p\/(\d+)(?:[/?#]|$)/i;
const IMAGE_ATTRIBUTES=["data-src","data-original","data-lazy-src","src","data-image","srcset","data-srcset"];
const normalize=x=>String(x||"").normalize("NFKC").toLowerCase()
 .replace(/&amp;/g,"&").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
export function carrefourPdpId(input){
 try{
  const url=new URL(input,BASE);
  if(url.protocol!=="https:"||url.hostname!=="www.carrefouruae.com"||
     url.username||url.password||url.port)return null;
  return url.pathname.match(PRODUCT_ID)?.[1]??null;
 }catch{return null;}
}
function imageUrl(value){
 if(typeof value!=="string")return null;
 const raw=value.split(/\s*,\s*/)[0]?.trim().split(/\s+/)[0]??"";
 if(!raw||raw.length>1500||/^(?:data:|blob:|javascript:)/i.test(raw))return null;
 try{
  const url=new URL(raw,BASE);
  if(url.protocol!=="https:"||url.username||url.password||url.port||
     /\.(?:svg|js|css|map|json)(?:$)/i.test(url.pathname))return null;
  return url.href;
 }catch{return null;}
}
function strongAltMatch(title,alt){
 const a=normalize(title),b=normalize(alt);
 if(!a||!b||b.length<10)return false;
 if(a===b)return true;
 const tokensA=new Set(a.split(" ").filter(t=>t.length>2));
 const tokensB=new Set(b.split(" ").filter(t=>t.length>2));
 if(tokensA.size<3||tokensB.size<3)return false;
 const overlap=[...tokensA].filter(t=>tokensB.has(t)).length;
 return overlap>=3 && overlap/Math.max(tokensA.size,tokensB.size)>=0.7;
}
export function inspectCarrefourImageEvidence(html,{sourceUrl,title,maxAncestors=6}={}){
 if(typeof html!=="string"||html.length>8_000_000)throw new Error("invalid_carrefour_html_fixture");
 const id=carrefourPdpId(sourceUrl);
 if(!id||typeof title!=="string"||title.trim().length<5)
  throw new Error("invalid_carrefour_product_identity");
 if(!Number.isInteger(maxAncestors)||maxAncestors<1||maxAncestors>8)
  throw new Error("invalid_carrefour_ancestor_limit");
 const $=load(html,{decodeEntities:true});
 const anchors=$("a[href]").filter((_,el)=>carrefourPdpId($(el).attr("href"))===id).toArray().slice(0,12);
 let best=null;
 for(const anchor of anchors){
  let node=$(anchor);
  for(let level=0;level<maxAncestors;level++){
   node=node.parent();
   if(!node.length)break;
   const productIds=new Set();
   node.find("a[href]").each((_,el)=>{
    const otherId=carrefourPdpId($(el).attr("href"));
    if(otherId)productIds.add(otherId);
   });
   if(productIds.size!==1||!productIds.has(id))break;
   const images=[];
   node.find("img,source").slice(0,30).each((_,el)=>{
    const image=$(el);
    const alt=image.attr("alt")||"";
    for(const attribute of IMAGE_ATTRIBUTES){
     const url=imageUrl(image.attr(attribute));
     if(!url)continue;
     images.push({
      url,host:new URL(url).hostname,
      origin:attribute,matchedTitle:strongAltMatch(title,alt),
      explicitId:String(image.attr("data-product-id")||image.attr("data-sku")||"")===id
     });
     break;
    }
   });
   if(!images.length)continue;
   const unique=[...new Map(images.map(x=>[x.url,x])).values()];
   const strong=unique.filter(x=>x.matchedTitle||x.explicitId);
   const status=strong.length===1?"unique_product_image_evidence":
    strong.length>1?"ambiguous_matching_images":"unverified_nearby_images";
   const entry={pdpId:id,status,ancestorLevel:level+1,
    evidenceCount:unique.length,matchingCount:strong.length,
    // URLs are diagnostic only, and MUST NOT be copied to any customer offer.
    candidateImageHosts:[...new Set(unique.map(x=>x.host))].slice(0,6),
    candidateEvidence:unique.slice(0,5).map(x=>({
      host:x.host,origin:x.origin,matchedTitle:x.matchedTitle,explicitId:x.explicitId
    }))};
   if(!best||entry.matchingCount>best.matchingCount)best=entry;
   if(status==="unique_product_image_evidence")return entry;
  }
 }
 return best||{pdpId:id,status:anchors.length?"no_image_with_unique_product_card":"no_matching_product_anchor",
  ancestorLevel:null,evidenceCount:0,matchingCount:0,candidateImageHosts:[],candidateEvidence:[]};
}
