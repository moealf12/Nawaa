import { CheerioCrawler } from "crawlee";
const startUrls=process.argv.slice(2);
if(!startUrls.length) throw new Error("Pass one or more public product URLs");
const api=(process.env.NAWAA_API_BASE||"http://localhost:10000").replace(/\/$/,"");
const token=process.env.NAWAA_INGEST_TOKEN;
if(!token) throw new Error("NAWAA_INGEST_TOKEN is required");
const crawler=new CheerioCrawler({
  maxConcurrency:Number(process.env.CRAWLER_CONCURRENCY||4),
  maxRequestRetries:2,
  async requestHandler({request,$}){
    const ld=[];
    $('script[type="application/ld+json"]').each((_,el)=>{try{const v=JSON.parse($(el).text());ld.push(...(Array.isArray(v)?v:[v]));}catch{}});
    const flat=ld.flatMap(v=>v?.['@graph']||[v]);
    const p=flat.find(v=>v?.['@type']==='Product'||(Array.isArray(v?.['@type'])&&v['@type'].includes('Product')));
    const offer=Array.isArray(p?.offers)?p.offers[0]:p?.offers;
    if(!p||!offer?.price) return;
    const item={title:p.name,brand:typeof p.brand==='string'?p.brand:p.brand?.name||null,merchant:new URL(request.loadedUrl).hostname,sourceUrl:offer.url||request.loadedUrl,imageUrl:Array.isArray(p.image)?p.image[0]:p.image||null,currency:offer.priceCurrency||null,productPrice:Number(offer.price),sku:p.sku||p.mpn||null,availability:String(offer.availability||"unknown").split("/").pop().toLowerCase(),condition:String(offer.itemCondition||"new").split("/").pop().toLowerCase(),observedAt:new Date().toISOString()};
    const res=await fetch(api+"/api/ingest/offers",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token},body:JSON.stringify({source:"crawlee",offers:[item]})});
    if(!res.ok) throw new Error("ingest failed "+res.status);
  }
});
await crawler.run(startUrls);
