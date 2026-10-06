import { searchViaConstructor } from "../server/providers/jarir.mjs";

const query=process.argv.slice(2).join(" ")||"iPhone 17";
const started=Date.now();
try{
  const offers=await searchViaConstructor(query,96);
  const valid=offers.filter(o=>o.title&&Number.isFinite(o.productPrice)&&o.productPrice>0&&o.sourceUrl);
  const withImage=valid.filter(o=>o.image).length;
  const withModel=valid.filter(o=>o.specs?.modelNumber).length;
  const unique=new Set(valid.map(o=>o.sourceUrl)).size;
  const prices=valid.map(o=>o.productPrice);
  console.log("JARIR_SEARCH_RESULTS_FIRST "+JSON.stringify({
    ok:valid.length>0,query,elapsedMs:Date.now()-started,
    returned:offers.length,valid:valid.length,unique,withImage,withModel,
    minPrice:prices.length?Math.min(...prices):null,maxPrice:prices.length?Math.max(...prices):null,
    paginationError:offers.paginationError||null,
    sample:valid.slice(0,10).map(o=>({title:o.title,price:o.productPrice,currency:o.currency,image:Boolean(o.image),productId:o.sourceMeta?.productId,model:o.specs?.modelNumber,url:o.sourceUrl}))
  }));
  if(!valid.length) process.exitCode=1;
}catch(error){
  console.log("JARIR_SEARCH_RESULTS_FIRST "+JSON.stringify({ok:false,query,elapsedMs:Date.now()-started,error:error instanceof Error?error.message:String(error)}));
  process.exitCode=1;
}
