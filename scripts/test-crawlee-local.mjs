import { extractProductWithCrawlee } from "../server/universal-acquisition.mjs";

const url=process.argv[2]||"https://www.jarir.com/sa-en/apple/apple-iphone-17-smartphones-666784.html";
const started=Date.now();
try{
  const offer=await extractProductWithCrawlee(url,{timeoutMs:15000});
  console.log("CRAWLEE_LOCAL_RESULT "+JSON.stringify({ok:true,elapsedMs:Date.now()-started,title:offer.title,price:offer.productPrice,currency:offer.originalCurrency,sku:offer.sku,gtin:offer.gtin,modelNumber:offer.modelNumber,image:offer.image,availability:offer.availability,sourceUrl:offer.sourceUrl,extraction:offer.extraction}));
}catch(error){
  console.log("CRAWLEE_LOCAL_RESULT "+JSON.stringify({ok:false,elapsedMs:Date.now()-started,error:error instanceof Error?error.message:String(error)}));
  process.exitCode=1;
}
