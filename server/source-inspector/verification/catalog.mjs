import {probeHtml} from "../probes/html.mjs";
function number(text){const m=String(text).replace(/,/g,"").match(/\b(\d+)\b/);return m?Number(m[1]):null}
export function extractCatalogEvidence(html=""){
 const text=String(html).replace(/<[^>]+>/g," ").replace(/\s+/g," ");
 const range=text.match(/\b(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+products?\b/i)||text.match(/\b(\d+)\s*-\s*(\d+)\s+من\s+(\d+)\s+(?:منتج|منتجات)\b/i);
 const totalMatch=text.match(/\b(\d+)\s+products?\s+Sort\b/i)||text.match(/\b(\d+)\s+(?:منتج|منتجات)\s+(?:ترتيب|فرز)/i);
 const pageSizeMatch=text.match(/Item\s+per\s+page\s+(\d+)/i);
 const price=text.match(/(\d[\d,]*)\s*SAR\s*-\s*(\d[\d,]*)\s*SAR/i);
 const currentStart=range?Number(range[1]):null,currentEnd=range?Number(range[2]):null,total=range?Number(range[3]):number(totalMatch?.[1]);
 const pageSize=pageSizeMatch?Number(pageSizeMatch[1]):currentStart&&currentEnd?currentEnd-currentStart+1:null;
 return {ok:Number.isFinite(total)&&total>0,total,currentStart,currentEnd,pageSize,hasMore:Boolean(total&&currentEnd&&currentEnd<total),priceMin:price?Number(price[1].replace(/,/g,"")):null,priceMax:price?Number(price[2].replace(/,/g,"")):null,currency:/\bSAR\b/i.test(text)?"SAR":null};
}
export async function verifyCatalogPage(url,options={}){
 const html=await probeHtml(url,options);if(!html.ok)return {passed:false,url,status:html.status,error:html.error};
 const evidence=extractCatalogEvidence(html.html);return {...evidence,passed:evidence.ok&&evidence.total>=evidence.currentEnd,url:html.finalUrl||url,status:html.status,latencyMs:html.latencyMs};
}
