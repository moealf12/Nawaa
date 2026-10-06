import { searchViaConstructor } from "../server/providers/jarir.mjs";
import { assessOfferMatch, productCategory } from "../src/search-query.mjs";

const query=process.argv.slice(2).join(" ")||"iPhone 17";
const started=Date.now();
try{
  const raw=await searchViaConstructor(query,96);
  const classified=raw.map(o=>({...o,...assessOfferMatch(query,o),category:productCategory(o)}));
  const buckets={};
  for(const o of classified){
    const key=o.category||"other";
    (buckets[key]??=[]).push(o);
  }
  for(const values of Object.values(buckets)) values.sort((a,b)=>b.matchConfidence-a.matchConfidence||a.productPrice-b.productPrice);
  console.log("JARIR_CLASSIFY_ALL_RESULT "+JSON.stringify({
    ok:classified.length===raw.length,query,elapsedMs:Date.now()-started,
    raw:raw.length,classified:classified.length,dropped:raw.length-classified.length,
    categories:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v.length])),
    exactMatches:classified.filter(o=>o.exactMatch).length,
    samples:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v.slice(0,8).map(o=>({title:o.title,price:o.productPrice,confidence:o.matchConfidence,exact:o.exactMatch,productId:o.sourceMeta?.productId}))]))
  }));
  if(classified.length!==raw.length) process.exitCode=1;
}catch(error){console.log("JARIR_CLASSIFY_ALL_RESULT "+JSON.stringify({ok:false,query,elapsedMs:Date.now()-started,error:error instanceof Error?error.message:String(error)}));process.exitCode=1;}
