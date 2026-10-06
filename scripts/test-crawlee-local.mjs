import { extractProductWithCrawlee } from "../server/universal-acquisition.mjs";

const urls=[
  "https://www.jarir.com/sa-en/apple/apple-iphone-17-smartphones-666784.html",
  "https://www.jarir.com/sa-en/catalogsearch/result/?q=iphone%2017"
];

const results=[];
for(const url of urls){
  const started=Date.now();
  try{
    const offer=await extractProductWithCrawlee(url,{timeoutMs:15000});
    results.push({ok:true,url,elapsedMs:Date.now()-started,title:offer.title,price:offer.productPrice,currency:offer.originalCurrency,sku:offer.sku,modelNumber:offer.modelNumber,image:offer.image,availability:offer.availability,sourceUrl:offer.sourceUrl,extraction:offer.extraction});
  }catch(error){
    results.push({ok:false,url,elapsedMs:Date.now()-started,error:error instanceof Error?error.message:String(error)});
  }
}
console.log("CRAWLEE_LOCAL_BATCH_RESULT "+JSON.stringify({attempted:results.length,succeeded:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results}));
if(!results[0]?.ok) process.exitCode=1;
