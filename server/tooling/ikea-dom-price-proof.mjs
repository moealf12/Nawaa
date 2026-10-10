// IKEA-specific HTML price proof; no database or queue writes.
// Inspect merchant-delivered HTML, not script/JSON-LD content.
import {load} from "cheerio";
import {fetchHtmlSafe} from "../url-resolver.mjs";

export function visibleIkeaPriceFromHtml(html,expectedTitle){
 const $=load(html);
 $("script,style,noscript,template,svg").remove();
 const nodes=$(".pipcom-pip-price-module");
 if(nodes.length!==1)return {status:"unavailable",reason:"unique_visible_price_module_required"};
 const rendered=$(nodes[0]).text().replace(/\s+/g," ").trim();
 const matches=[...rendered.matchAll(/﷼\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d.,])/g)]
  .map(m=>Number(m[1].replace(/,/g,"")+(m[2]?"."+m[2]:"")));
 const values=[...new Set(matches)];
 if(!values.length)return {status:"unavailable",reason:"no_sar_amount_in_visible_module"};
 if(values.length!==1)return {status:"conflict",reason:"multiple_visible_price_amounts",values};
 const expectedFirst=String(expectedTitle||"").normalize("NFKC").toLowerCase()
  .match(/[\p{L}\p{N}]{3,}/u)?.[0]||"";
 const header=rendered.split("﷼")[0].normalize("NFKC").toLowerCase();
 if(!expectedFirst||!header.includes(expectedFirst))
  return {status:"unavailable",reason:"visible_product_title_mismatch"};
 return {status:"matched_module",price:values[0],currency:"SAR",copies:matches.length};
}
function approvedSamePage(initial,returned){
 try{
  const a=new URL(initial),b=new URL(returned);
  const allowed=["ikea.com","www.ikea.com"];
  return a.protocol==="https:"&&b.protocol==="https:"&&
    allowed.includes(a.hostname)&&allowed.includes(b.hostname)&&
    a.pathname.replace(/\/+$/,"")===b.pathname.replace(/\/+$/,"")&&
    a.search===b.search&&!b.hash&&!b.username&&!b.password&&!b.port;
 }catch{return false;}
}
export async function verifyIkeaVisiblePrice(offer,{fetchPage=fetchHtmlSafe}={}){
 if(!offer||typeof offer.title!=="string"||typeof offer.sourceUrl!=="string"||
    !Number.isFinite(offer.productPrice)||offer.currency!=="SAR")
   throw new Error("invalid_visible_price_proof_input");
 const response=await fetchPage(offer.sourceUrl);
 if(!approvedSamePage(offer.sourceUrl,response?.finalUrl))
  throw new Error("visible_price_page_identity_mismatch");
 const visible=visibleIkeaPriceFromHtml(response.html,offer.title);
 if(visible.status!=="matched_module"||visible.currency!==offer.currency||
    visible.price!==offer.productPrice)
  throw new Error("visible_price_evidence_mismatch");
 return {status:"matched",strategy:"merchant_html_product_price_module",
   price:visible.price,currency:visible.currency,copies:visible.copies};
}
