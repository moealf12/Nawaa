import {probeHtml} from "../probes/html.mjs";import {extractJsonLdProducts} from "../probes/jsonld.mjs";import {discoverPagination} from "../discovery/pagination.mjs";import {verifyPagination} from "./pagination.mjs";
function identity(p){return p.sourceProductId??p.sku??p.productUrl??null}
export async function verifyPaginationLive(startUrl,{fetchImpl=fetch,maxPages=5,timeoutMs=6000}={}){
 const pages=[],visited=new Set();let url=startUrl,termination="max-pages";
 for(let index=1;index<=maxPages&&url&&!visited.has(url);index++){
  visited.add(url);const html=await probeHtml(url,{fetchImpl,timeoutMs});
  if(!html.ok){termination="fetch-failed";break}
  const products=extractJsonLdProducts(html.html);const pagination=discoverPagination(html.html,html.finalUrl||url);
  pages.push({page:index,url:html.finalUrl||url,items:products.map(p=>({id:identity(p),sku:p.sku,url:p.productUrl})).filter(x=>x.id)});
  const next=pagination.candidates.find(c=>c.model==="next-link")?.url??pagination.candidates.find(c=>!visited.has(c.url))?.url??null;
  if(!next){termination="natural-end";break}if(visited.has(next)){termination="cycle";break}url=next;
 }
 const verification=verifyPagination(pages);return {...verification,pagesVisited:pages.length,visitedUrls:[...visited],termination,passed:verification.passed&&termination!=="cycle"&&termination!=="fetch-failed"};
}
