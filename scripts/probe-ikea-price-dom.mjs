// Strictly read-only DOM price inspection: never send or persist offers.
import {load} from "cheerio";
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {PILOT_PRODUCTS} from "./probe-ikea-batch.mjs";
import {extractCertifiedMerchantOffer} from "../server/tooling/merchant-observation-producer.mjs";
const selectors=[
 ".pip-product-buy-module__price",
 ".pip-price",
 "[data-testid='price']",
 "[class*='product-buy-module__price']",
 "[class*='pip-price']"
];
export function summarizePriceDom(html){
 const $=load(html);
 $("script,style,noscript,template,svg").remove();
 const evidence=[];
 for(const selector of selectors){
  const nodes=$(selector).slice(0,6);
  nodes.each((i,node)=>{
   const el=$(node);
   const text=el.text().replace(/\s+/g," ").trim().slice(0,180);
   const className=String(el.attr("class")||"").slice(0,140);
   if(text)evidence.push({selector,className,text});
  });
 }
 return evidence.slice(0,12);
}
export function visibleIkeaPriceFromHtml(html,expectedTitle){
 const $=load(html);
 $("script,style,noscript,template,svg").remove();
 const nodes=$(".pipcom-pip-price-module");
 if(nodes.length!==1)return {status:"unavailable",reason:"unique_visible_price_module_required"};
 const rendered=$(nodes[0]).text().replace(/\s+/g," ").trim();
 const matches=[...rendered.matchAll(/﷼\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g)]
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
export async function inspectDomPrices({products=PILOT_PRODUCTS,fetchPage=fetchHtmlSafe}={}){
 if(products.length>5)throw Error("bounded_probe_only");
 const entries=[];
 for(const item of products){
  try{
   const page=await fetchPage(item.url);
   const structured=await extractCertifiedMerchantOffer({sourceId:"ikea-sa",url:item.url});
   const visible=visibleIkeaPriceFromHtml(page.html,structured.offer.title);
   const agrees=visible.status==="matched_module"&&visible.price===structured.offer.productPrice;
   entries.push({sku:item.sku,structuredPrice:structured.offer.productPrice,visible,
    agrees,domCandidates:summarizePriceDom(page.html)});
  }catch(error){
   entries.push({sku:item.sku,error:String(error.message).slice(0,90)});
  }
 }
 const matched=entries.filter(x=>x.agrees).length;
 return {mode:"read_only_visible_dom_price_comparison",matched,total:entries.length,
  passed:matched===entries.length,entries};
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 if(process.env.DATABASE_URL||process.env.NAWAA_ENABLE_BACKGROUND_JOBS==="1")throw Error("read_only_only");
 const result=await inspectDomPrices();
 console.log(JSON.stringify(result,null,2));
 if(!result.passed)process.exitCode=1;
}
