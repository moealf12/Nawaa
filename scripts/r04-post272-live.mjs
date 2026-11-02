import {writeFileSync} from "node:fs";
import {normalizeSearchQuery,parseSearchIntent,assessOfferMatch} from "../src/search-query.mjs";
import {groupComparableOffers,buildDiscoverySections} from "../src/search-core.mjs";
const API="https://nawaa-search-api.onrender.com",MAX_BYTES=3_000_000;
const EXPECTED_SHA="35082765cfa63ab4100dfe757bf772b1b47a9e71";
const CASES=[
 {id:"DYSON_MODEL",query:"Dyson V15",required:true},
 {id:"Q22_AR",query:"مكنسة دايسون V15",required:true},
 {id:"Q21_EN",query:"Dyson V15 vacuum cleaner",required:false},
 {id:"Q20_CANON",query:"كاميرا كانون بدون مرآة",required:false},
 {id:"Q34_WATCH",query:"ساعة ابل سيريس 11",required:false},
];
const clip=x=>String(x??"").slice(0,170);
function actualDysonModel(title){
 const t=normalizeSearchQuery(title||"");
 return /(?:^| )dyson v15(?= |$)/.test(t);
}
async function readJson(path,ms=30000){
 const r=await fetch(new URL(path,API),{
  headers:{accept:"application/json","cache-control":"no-cache"},redirect:"error",
  signal:AbortSignal.timeout(ms)});
 if(Number(r.headers.get("content-length")||0)>MAX_BYTES)throw Error("DECLARED_BODY_TOO_LARGE");
 if(!r.body)throw Error("MISSING_BODY");
 const parts=[];let bytes=0;
 for await(const part of r.body){bytes+=part.byteLength;if(bytes>MAX_BYTES)throw Error("BODY_TOO_LARGE");parts.push(part)}
 return {http:r.status,body:JSON.parse(Buffer.concat(parts,bytes).toString("utf8"))};
}
async function health(){
 const r=await readJson("/health",20000);
 const h={http:r.http,ok:r.body?.ok===true,revision:r.body?.revision??null};
 if(h.http!==200||!h.ok||h.revision!==EXPECTED_SHA)throw Error("LIVE_SHA_MISMATCH");
 return h;
}
async function rowFor(c){
 const row={id:c.id,query:c.query,status:"NOT_RUN",offers:null,exact:null,visible:null,
  sourceErrors:null,partial:null,providersPending:null,wrongExact:[],firstFive:[],error:null,
  verdict:"UNKNOWN"};
 try{
  const r=await readJson("/api/search?q="+encodeURIComponent(c.query));
  if(r.http!==200||!Array.isArray(r.body?.offers))throw Error("INVALID_API_RESPONSE");
  const intent=parseSearchIntent(c.query),offers=r.body.offers;
  const groups=groupComparableOffers(offers,"lowest");
  const strict=groups.filter(g=>g.bestOffer?.exactMatch===true&&
   (g.bestOffer?.matchConfidence||0)>=.9&&
   g.bestOffer?.condition===(intent.condition||"new"));
  const visible=buildDiscoverySections(c.query,strict).flatMap(s=>s.groups.slice(0,10)).slice(0,10);
  row.status="OBSERVED";row.offers=offers.length;row.exact=strict.length;
  row.visible=visible.length;row.sourceErrors=Array.isArray(r.body.errors)?r.body.errors.length:null;
  row.partial=r.body.coverage?.partial===true;row.providersPending=r.body.coverage?.providersPending??null;
  row.firstFive=visible.slice(0,5).map(g=>({
   title:clip(g.bestOffer?.title),
   exact:g.bestOffer?.exactMatch===true,
   physicalModel:actualDysonModel(g.bestOffer?.title),
   replayExact:assessOfferMatch(c.query,g.bestOffer).exactMatch
  }));
  if(c.id.startsWith("DYSON")||c.id.startsWith("Q22")||c.id.startsWith("Q21")){
    row.wrongExact=strict.filter(g=>!actualDysonModel(g.bestOffer?.title))
     .slice(0,10).map(g=>clip(g.bestOffer?.title));
    row.verdict=row.wrongExact.length?"WRONG_MODEL_EXACT":
      strict.length?"PHYSICAL_DYSON_PRESENT":"NO_STRICT_DYSON_EVIDENCE";
  }else row.verdict="OBSERVED_NOT_CERTIFIED";
 }catch(e){row.status="REQUEST_FAILED";row.error=clip(e?.name||"UNKNOWN_ERROR");row.verdict="REQUEST_FAILED";}
 console.log("R04_POST272_ROW "+JSON.stringify(row));
 return row;
}
async function main(){
 const report={schemaVersion:"nawaa.r04.p0.dyson.post272.v1",expectedSha:EXPECTED_SHA,
  startedAt:new Date().toISOString(),before:null,after:null,rows:[],fatal:null,
  fullR04Certified:false,domSseParityVerified:false,
  limitations:["Queries are separate source snapshots, not controlled paired requests.",
   "Exactness based on title/model evidence and deployed matcher, not independent catalog authenticity.",
   "Zero strict results do not prove stock absence.",
   "All-source coverage and 36-intent bilingual acceptance are outside this limited gate."]};
 try{
  report.before=await health();
  for(const c of CASES)report.rows.push(await rowFor(c));
  report.after=await health();
 }catch(e){report.fatal=clip(e?.message||e);}
 const must=report.rows.filter(x=>["DYSON_MODEL","Q22_AR"].includes(x.id));
 const allQueried=report.rows.length===CASES.length&&report.rows.every(x=>x.status==="OBSERVED");
 const noWrong=report.rows.filter(x=>x.wrongExact.length);
 const recovered=must.length===2&&must.every(x=>x.verdict==="PHYSICAL_DYSON_PRESENT");
 report.summary={attempted:report.rows.length,observed:report.rows.filter(x=>x.status==="OBSERVED").length,
   dysonArabicAndEnglishRecovered:recovered,wrongExactCases:noWrong.map(x=>x.id),
   partial:report.rows.filter(x=>x.partial).length,
   sourceErrorEvents:report.rows.reduce((n,x)=>n+(x.sourceErrors||0),0),
   result:report.fatal||!allQueried?"INCOMPLETE":
     noWrong.length?"WRONG_DYSON_MODEL_LIVE":recovered?"LIMITED_RECOVERY_OBSERVED":"RECALL_NOT_PROVEN",
   fullR04Certified:false};
 report.completedAt=new Date().toISOString();
 writeFileSync("r04-post272-live.json",JSON.stringify(report,null,2)+"\n");
 console.log("R04_POST272_SUMMARY "+JSON.stringify(report.summary));
 if(report.summary.result!=="LIMITED_RECOVERY_OBSERVED")process.exitCode=1;
}
await main();
