import { discoverProductUrlsWithCrawlee, extractProductWithCrawlee } from "../server/universal-acquisition.mjs";

const searchUrl="https://www.jarir.com/sa-en/catalogsearch/result/?q=iphone%2017";
const started=Date.now();
const urls=await discoverProductUrlsWithCrawlee(searchUrl,{limit:12,timeoutMs:15000,allowedHost:"www.jarir.com"});
const candidates=urls.filter(url=>/iphone|smartphones/i.test(url)).slice(0,6);
const results=[];
for(const url of candidates){
  const t=Date.now();
  try{const o=await extractProductWithCrawlee(url,{timeoutMs:15000});results.push({ok:true,elapsedMs:Date.now()-t,title:o.title,price:o.productPrice,currency:o.originalCurrency,sku:o.sku,modelNumber:o.modelNumber,availability:o.availability,sourceUrl:o.sourceUrl,confidence:o.extraction?.confidence});}
  catch(error){results.push({ok:false,elapsedMs:Date.now()-t,url,error:error instanceof Error?error.message:String(error)});}
}
console.log("CRAWLEE_JARIR_DISCOVERY_RESULT "+JSON.stringify({searchUrl,elapsedMs:Date.now()-started,discovered:urls.length,candidates:candidates.length,succeeded:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,urls,results}));
if(!urls.length||!results.some(x=>x.ok)) process.exitCode=1;
