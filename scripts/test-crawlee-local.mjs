import { searchViaConstructor } from "../server/providers/jarir.mjs";
import { assessOfferMatch, filterQueryOffers, productCategory } from "../src/search-query.mjs";

const query=process.argv.slice(2).join(" ")||"iPhone 17";
const started=Date.now();
try{
  const raw=await searchViaConstructor(query,96);
  const scored=raw.map(o=>({...o,...assessOfferMatch(query,o),category:productCategory(o)}));
  const {offers,queryFilter}=filterQueryOffers(query,scored);
  const ranked=offers.sort((a,b)=>b.matchConfidence-a.matchConfidence||a.productPrice-b.productPrice);
  const categories=Object.fromEntries([...new Set(scored.map(o=>o.category))].map(k=>[k,scored.filter(o=>o.category===k).length]));
  console.log("JARIR_RELEVANCE_FILTER_RESULT "+JSON.stringify({
    ok:ranked.length>0,query,elapsedMs:Date.now()-started,
    raw:raw.length,retained:ranked.length,removed:queryFilter.removed,categories,
    retainedPriceRange:ranked.length?[Math.min(...ranked.map(o=>o.productPrice)),Math.max(...ranked.map(o=>o.productPrice))]:null,
    top:ranked.slice(0,20).map(o=>({title:o.title,price:o.productPrice,category:o.category,confidence:o.matchConfidence,exact:o.exactMatch,productId:o.sourceMeta?.productId}))
  }));
  if(!ranked.length) process.exitCode=1;
}catch(error){console.log("JARIR_RELEVANCE_FILTER_RESULT "+JSON.stringify({ok:false,query,elapsedMs:Date.now()-started,error:error instanceof Error?error.message:String(error)}));process.exitCode=1;}
