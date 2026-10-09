// Read-only multi-product probe against verified public IKEA Saudi product URLs.
// No database credentials, queues, signatures, paid API calls, or client search.
import https from "node:https";
import {extractCertifiedMerchantOffer} from "../server/tooling/merchant-observation-producer.mjs";
import {resolvePublicHttpsTarget} from "../server/url-resolver.mjs";
import {PILOT_PRODUCTS} from "../src/ikea-pilot-products.mjs";
export {PILOT_PRODUCTS};

function approvedOfficialImage(url){
 try{
  const parsed=new URL(url);
  return parsed.protocol==="https:"&&!parsed.username&&!parsed.password&&!parsed.port&&
   ["www.ikea.com","ikea.com"].includes(parsed.hostname.toLowerCase());
 }catch{return false;}
}
export async function headCheckIkeaImage(url,{resolve=resolvePublicHttpsTarget,timeoutMs=8000}={}){
 if(!approvedOfficialImage(url))return {reachable:false,reason:"unapproved_image_host"};
 try{
  const target=await resolve(url);
  return await new Promise((done)=>{
   const parsed=target.parsed;
   const req=https.request({
    protocol:"https:",hostname:parsed.hostname,port:443,method:"HEAD",
    path:parsed.pathname+parsed.search,
    servername:parsed.hostname,agent:false,
    headers:{host:parsed.host,accept:"image/*"},
    lookup:(_h,opts,cb)=>opts?.all
      ?cb(null,[{address:target.address,family:target.family}])
      :cb(null,target.address,target.family)
   },res=>{
    const type=String(res.headers["content-type"]||"").split(";")[0].trim().toLowerCase();
    const ok=res.statusCode===200&&/^image\/(?:jpeg|png|webp|avif)$/.test(type);
    res.resume();done({reachable:ok,status:res.statusCode,type,
      reason:ok?null:"unexpected_image_response"});
   });
   req.on("error",error=>done({reachable:false,reason:String(error.code||"image_request_failed")}));
   req.setTimeout(timeoutMs,()=>req.destroy(new Error("image_timeout")));
   req.end();
  });
 }catch(error){
  return {reachable:false,reason:String(error.code||error.message||"image_lookup_failed").slice(0,90)};
 }
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runIkeaReadOnlyBatch({products=PILOT_PRODUCTS,extract,probeImage=headCheckIkeaImage,
 delayMs=700,repeatExtract=true}={}){
 if(!Array.isArray(products)||!products.length||products.length>5)throw new Error("invalid_bounded_pilot_batch");
 const items=[];
 for(const item of products){
  const started=Date.now();
  try{
   const params={sourceId:"ikea-sa",url:item.url};
   if(extract)params.extract=extract;
   const {offer,evidence}=await extractCertifiedMerchantOffer(params);
   const skuMatched=offer.sku.replace(/\D/g,"")===item.sku;
   if(!skuMatched)throw new Error("batch_expected_sku_mismatch");
   // Second fresh page extraction detects transient merchant price/variant drift.
   // This is repeatability evidence, NOT an independent visible-price verification.
   let repeatability="not_checked";
   if(repeatExtract){
    const second=await extractCertifiedMerchantOffer(params);
    if(second.offer.sku!==offer.sku||second.offer.currency!==offer.currency||
       second.offer.productPrice!==offer.productPrice||
       second.offer.sourceUrl!==offer.sourceUrl)
      throw new Error("repeated_merchant_observation_disagreed");
    repeatability="matched";
   }
   const image=offer.imageUrl ? await probeImage(offer.imageUrl) : {reachable:false,reason:"missing_image"};
   items.push({sku:item.sku,category:item.category,ok:true,title:offer.title,
    price:offer.productPrice,currency:offer.currency,
    hasImage:Boolean(offer.imageUrl),imageUrl:offer.imageUrl||null,
    imageReachable:image.reachable===true,imageStatus:image.status??null,
    imageReason:image.reason??null,priceCrossCheck:evidence.priceCrossCheck,
    secondaryPriceEvidence:evidence.secondaryPriceEvidence,
    secondaryPriceMatches:evidence.secondaryPriceMatches,repeatability,
    strategy:evidence.extractionStrategy,elapsedMs:Date.now()-started});
  }catch(error){
   items.push({sku:item.sku,category:item.category,ok:false,
    error:String(error.message||error).slice(0,140),elapsedMs:Date.now()-started});
  }
  if(items.length<products.length&&delayMs>0)await delay(delayMs);
 }
 const count=(p)=>items.filter(p).length, total=items.length;
 const metrics={total,extracted:count(x=>x.ok),images:count(x=>x.ok&&x.hasImage),
  reachableImages:count(x=>x.ok&&x.imageReachable),
  skuMatched:count(x=>x.ok),metadataCrossChecked:count(x=>x.priceCrossCheck==="matched"),
  exactSkuSecondaryCrossChecked:count(x=>x.secondaryPriceEvidence==="matched"),
  repeatedPriceMatched:count(x=>x.repeatability==="matched"),
  failures:count(x=>!x.ok)};
 // The probe must expose weak coverage rather than forcing price acceptance.
 const passed=metrics.extracted>=Math.ceil(total*0.8)&&metrics.reachableImages>=Math.ceil(total*0.8)&&metrics.skuMatched===metrics.extracted&&(!repeatExtract||metrics.repeatedPriceMatched===metrics.extracted);
 return {mode:"read_only_multi_product_no_database_write",sourceId:"ikea-sa",
  capturedAt:new Date().toISOString(),passed,metrics,items};
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 if(process.env.DATABASE_URL||process.env.NAWAA_ENABLE_BACKGROUND_JOBS==="1"||
    process.env.NAWAA_ENABLE_CERTIFIED_INGESTION==="1")throw new Error("read_only_environment_required");
 const report=await runIkeaReadOnlyBatch();
 console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
}
