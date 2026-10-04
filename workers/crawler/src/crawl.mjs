import { CheerioCrawler, PlaywrightCrawler, RequestQueue } from "crawlee";
import { extractOffersFromPage } from "./extractors.mjs";

const startUrls=process.argv.slice(2);
if(!startUrls.length) throw new Error("Pass one or more public product or search URLs");
const api=(process.env.NAWAA_API_BASE||"http://localhost:10000").replace(/\/$/,"");
const token=process.env.NAWAA_INGEST_TOKEN;
if(!token) throw new Error("NAWAA_INGEST_TOKEN is required");
const renderHosts=new Set(String(process.env.NAWAA_BROWSER_HOSTS||"").split(",").map(x=>x.trim()).filter(Boolean));
const queue=await RequestQueue.open();
await queue.addRequests(startUrls.map(url=>({url,userData:{depth:0}})));

async function ingest(offers,source){
 if(!offers.length)return;
 const res=await fetch(api+"/api/ingest/offers",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token},body:JSON.stringify({source,offers})});
 if(!res.ok)throw new Error("ingest failed "+res.status);
}
function browserNeeded(url){const h=new URL(url).hostname;return [...renderHosts].some(x=>h===x||h.endsWith("."+x));}

const direct=new CheerioCrawler({
 requestQueue:queue,maxConcurrency:Number(process.env.CRAWLER_CONCURRENCY||8),maxRequestRetries:2,
 async requestHandler({request,$,enqueueLinks}){
   if(browserNeeded(request.loadedUrl)){await browserQueue.addRequest({url:request.loadedUrl,userData:request.userData});return;}
   const offers=extractOffersFromPage({$,url:request.loadedUrl});
   await ingest(offers,"crawlee-http");
   if((request.userData.depth||0)<1) await enqueueLinks({strategy:"same-domain",selector:'a[href*="/product"],a[href*="/p/"],a[href*="/products/"]',transformRequestFunction:r=>({...r,userData:{depth:1}})});
 }
});
const browserQueue=await RequestQueue.open("browser");
await direct.run();

if(await browserQueue.getTotalCount()){
 const browser=new PlaywrightCrawler({
   requestQueue:browserQueue,maxConcurrency:Number(process.env.BROWSER_CONCURRENCY||2),maxRequestRetries:1,
   launchContext:{launchOptions:{headless:true}},
   async requestHandler({request,page}){
     await page.waitForLoadState("domcontentloaded");
     const payload=await page.evaluate(()=>({html:document.documentElement.outerHTML,url:location.href}));
     // Rendered pages are sent through the same deterministic extractor using a
     // lightweight local DOM parse in a follow-up HTTP pass when structured data exists.
     const jsonlds=await page.locator('script[type="application/ld+json"]').allTextContents();
     const offers=[];
     for(const raw of jsonlds){try{const root=JSON.parse(raw);const stack=Array.isArray(root)?root:[root];for(const p of stack.flatMap(x=>x?.["@graph"]||[x])){if(p?.["@type"]!=="Product")continue;const os=Array.isArray(p.offers)?p.offers:[p.offers].filter(Boolean);for(const o of os){const price=Number(String(o.price||"").replace(/,/g,""));if(price>0&&o.priceCurrency)offers.push({title:p.name,brand:typeof p.brand==="string"?p.brand:p.brand?.name||null,merchant:new URL(payload.url).hostname,sourceUrl:o.url||payload.url,imageUrl:Array.isArray(p.image)?p.image[0]:p.image||null,currency:o.priceCurrency,productPrice:price,sku:p.sku||p.mpn||null,availability:String(o.availability||"unknown").split("/").pop().toLowerCase(),condition:String(o.itemCondition||"new").split("/").pop().toLowerCase(),extractionStrategy:"rendered-jsonld",observedAt:new Date().toISOString()});}}}catch{}}
     await ingest(offers,"crawlee-browser");
   }
 });
 await browser.run();
}
