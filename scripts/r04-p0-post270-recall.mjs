// R04 P0: read-only causal recall forensics. Evidence only, no ranking changes.
// Compare frozen Arabic searches against separately requested English equivalents.
// Unknown products are not promoted; a zero strict group is not out-of-stock proof.
import {writeFileSync} from "node:fs";
import {normalizeSearchQuery,parseSearchIntent,assessOfferMatch,buildProviderFallbackQueries} from "../src/search-query.mjs";
import {groupComparableOffers,buildDiscoverySections} from "../src/search-core.mjs";
const BASE="https://nawaa-search-api.onrender.com",MAX_BYTES=3_000_000;
// This file is based on the R04 P0 forensic script, but uses the exact POST-270
// main implementation for match projection, so replay verdicts match production.
export const CASES=[
 {id:"Q20",pair:"canon",locale:"ar",query:"كاميرا كانون بدون مرآة"},
 {id:"Q19_EN",pair:"canon",locale:"en",query:"Canon mirrorless camera"},
 {id:"Q22",pair:"dyson",locale:"ar",query:"مكنسة دايسون V15"},
 {id:"Q21_EN",pair:"dyson",locale:"en",query:"Dyson V15 vacuum cleaner"},
 {id:"Q33",pair:"apple-watch",locale:"en",query:"Apple Watch Series 11"},
 {id:"Q34",pair:"apple-watch",locale:"ar",query:"ساعة ابل سيريس 11"},
 {id:"Q33_SHORT",pair:"apple-watch",locale:"en",query:"Apple Watch 11"},
 {id:"CANON_MODEL",pair:"canon",locale:"en",query:"Canon EOS R50 mirrorless camera"},
 {id:"DYSON_MODEL",pair:"dyson",locale:"en",query:"Dyson V15"},
 {id:"WATCH_GPS",pair:"apple-watch",locale:"en",query:"Apple Watch Series 11 GPS"},
 {id:"WATCH_AR_SHORT",pair:"apple-watch",locale:"ar",query:"ساعة ابل 11"}
];
const safe=x=>String(x??"").slice(0,160);
export function countPresentation(offers,query){
 const intent=parseSearchIntent(query);
 const groups=groupComparableOffers(offers,"lowest");
 const strict=groups.filter(g=>g.bestOffer?.exactMatch===true &&
   (g.bestOffer?.matchConfidence||0)>=0.9 &&
   g.bestOffer?.condition===(intent.condition||"new"));
 const visible=buildDiscoverySections(query,strict).flatMap(x=>x.groups.slice(0,10)).slice(0,10);
 return {allGroups:groups.length,strictGroups:strict.length,visibleGroups:visible.length,
  approximatePositiveConfidence:offers.filter(o=>(o.matchConfidence||0)>=0.65).length,
  exactOffers:offers.filter(o=>o.exactMatch===true).length};
}
function hostOnly(url){
 try{const u=new URL(url);return u.protocol==="https:"&&!u.username&&!u.password?u.hostname:null}
 catch{return null}
}
async function json(path,timeout=30000){
 const response=await fetch(new URL(path,BASE),{headers:{"accept":"application/json","cache-control":"no-cache"},
   redirect:"error",signal:AbortSignal.timeout(timeout)});
 if(Number(response.headers.get("content-length")||0)>MAX_BYTES)throw Error("DECLARED_TOO_BIG");
 let n=0;const parts=[];if(!response.body)throw Error("MISSING_BODY");
 for await(const part of response.body){n+=part.byteLength;if(n>MAX_BYTES)throw Error("BODY_TOO_BIG");parts.push(part)}
 return {status:response.status,body:JSON.parse(Buffer.concat(parts,n).toString("utf8"))};
}
async function health(expected){
 const r=await json("/health",20000);
 const item={http:r.status,ok:r.body?.ok===true,revision:r.body?.revision??null};
 if(item.http!==200||!item.ok||item.revision!==expected)throw Error("PRODUCTION_SHA_MISMATCH");
 return item;
}
async function observe(test){
 const row={id:test.id,pair:test.pair,locale:test.locale,query:test.query,
   normalized:normalizeSearchQuery(test.query),intent:null,fallbacks:[],
   topStrictTitles:[],coverageErrors:null,
   http:null,status:"NOT_RUN",offers:0,counts:null,partial:null,sourceErrors:null,
   providersPending:null,sourceFailures:[],sample:[],error:null};
 row.intent=parseSearchIntent(test.query);
 row.fallbacks=buildProviderFallbackQueries(test.query).slice(0,8);
 try{
   const r=await json("/api/search?q="+encodeURIComponent(test.query));
   row.http=r.status;
   if(r.status!==200||!Array.isArray(r.body?.offers))throw Error("INVALID_RESPONSE");
   row.status="OBSERVED";row.offers=r.body.offers.length;
   row.counts=countPresentation(r.body.offers,test.query);
   const strict=groupComparableOffers(r.body.offers,"lowest").filter(g=>
      g.bestOffer?.exactMatch===true&&(g.bestOffer?.matchConfidence||0)>=0.9&&
      g.bestOffer?.condition===(parseSearchIntent(test.query).condition||"new"));
   row.topStrictTitles=strict.slice(0,5).map(g=>safe(g.bestOffer?.title));
   row.partial=r.body.coverage?.partial===true;
   row.providersPending=r.body.coverage?.providersPending??null;
   row.sourceErrors=Array.isArray(r.body.errors)?r.body.errors.length:null;
   row.coverageErrors=r.body.coverage?.sourceFailures?.errorsReported??null;
   row.sourceFailures=Array.isArray(r.body.errors)?r.body.errors.slice(0,30).map(x=>({
     source:safe(x.sourceId||x.market||""),market:safe(x.market||""),
     type:/\b403\b/.test(safe(x.error))?"HTTP_403":/timeout/i.test(safe(x.error))?"TIMEOUT":"OTHER"
   })):[];
   // Reassess in isolation; this does not turn an alternative into a certified offer.
   row.sample=r.body.offers.slice(0,14).map(o=>{
     const judged=assessOfferMatch(test.query,o);
     return {title:safe(o.title),host:hostOnly(o.sourceUrl),merchant:safe(o.merchant),
       sourceExact:o.exactMatch===true,sourceConfidence:o.matchConfidence??null,
       recheckExact:judged.exactMatch,recheckConfidence:judged.matchConfidence,
       missingTerms:judged.missingTerms?.slice(0,10)||[],reason:safe(judged.matchReason),
       condition:safe(o.condition)};
   });
 }catch(error){row.status="REQUEST_FAILED";row.error=safe(error?.name||"UNKNOWN_ERROR");}
 console.log("R04_POST270_ROW "+JSON.stringify({id:row.id,status:row.status,normalized:row.normalized,
   offers:row.offers,counts:row.counts,partial:row.partial,sourceErrors:row.sourceErrors,
   topStrictTitles:row.topStrictTitles,providerQuery:row.intent?.providerQuery,error:row.error}));
 return row;
}
async function main(){
 const expected=String(process.env.NAWAA_EXPECT_LIVE_SHA||"");
 const report={schemaVersion:"nawaa.r04.p0.post270.v2",mode:"READ_ONLY_EXACT_SHA",
   expectedSha:expected,startedAt:new Date().toISOString(),
   warnings:["Comparisons are independent temporal requests, NOT same-snapshot A/B.",
     "Top candidate title samples are not human judgments.",
     "Server-returned offers do not include offers discarded upstream.",
     "Zero strict results cannot prove absence or out-of-stock.",
     "No persistent provider or cache changes.",
     "Visible groups use exact committed post-270 code, not stale PR269 code."],
   before:null,after:null,rows:[],pairs:[],fatal:null};
 try{
   if(!/^[a-f0-9]{40}$/.test(expected))throw Error("EXPECTED_SHA_INVALID");
   report.before=await health(expected);
   let next=0;const rows=new Array(CASES.length);
   await Promise.all(Array.from({length:2},async()=>{
    while(next<CASES.length){const i=next++;rows[i]=await observe(CASES[i]);}
   }));
   report.rows=rows;report.after=await health(expected);
   for(const pair of [...new Set(CASES.map(x=>x.pair))]){
     const xs=rows.filter(x=>x.pair===pair);
     report.pairs.push({pair,queries:xs.map(x=>({
       id:x.id,offers:x.offers,strict:x.counts?.strictGroups??null,partial:x.partial,
       errors:x.sourceErrors,status:x.status
     }))});
   }
 }catch(e){report.fatal=safe(e?.message||e);}
 report.completedAt=new Date().toISOString();
 report.summary={observed:report.rows.filter(x=>x.status==="OBSERVED").length,
   attempted:CASES.length,missingStrict:report.rows.filter(x=>x.status==="OBSERVED"&&x.counts?.strictGroups===0).map(x=>x.id),
   allPartial:report.rows.length===CASES.length&&report.rows.every(x=>x.partial===true),
   errorEvents:report.rows.reduce((n,x)=>n+(x.sourceErrors||0),0),
   fatal:report.fatal,certified:false};
 writeFileSync("r04-p0-post270-recall.json",JSON.stringify(report,null,2)+"\n");
 console.log("R04_POST270_SUMMARY "+JSON.stringify(report.summary));
 if(report.fatal||report.summary.observed!==CASES.length)process.exitCode=1;
}
await main();
