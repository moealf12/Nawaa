// Evidence-only R04 P1 public-production probe. Never certifies unjudged titles.
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {groupComparableOffers,buildDiscoverySections} from "../src/search-core.mjs";
import {parseSearchIntent} from "../src/search-query.mjs";

export const CASE_IDS=["Q07","Q19","Q20","Q21","Q22","Q29","Q30","Q31","Q32","Q33","Q34"];
const MAX_BYTES=3_000_000,API="https://nawaa-search-api.onrender.com";
const short=x=>String(x??"").slice(0,180);
export function knownWrongRetailSubject(id,title){
 const t=String(title??"").normalize("NFKC").toLowerCase();
 if(id==="Q07")return /\b(?:empty shell|drive housing|shell housing|connector replacement|repair kit|travel case|disc drive module|disc drive connector|connector module|kem[- ]?497aaa)\b/.test(t);
 if(id==="Q19")return /\b(?:camera hand strap|wrist strap|camera strap|prime lens|ef 50mm|camera bag|pocket guide|quick setup|master your mirrorless camera|mastering|ultimate guide|secrets and techniques|user guide|sling bag|crossbody bag|kameratasche)\b/.test(t)&&
   !/\b(?:eos r\d+.*mirrorless camera (?:body|kit)|camera body)\b/.test(t);
 if(id==="Q21"){const sold=t.split(/\bwith\b/,1)[0];return /\b(?:pretend play|toy vacuum|vacuum toy|kids? pretend|dryer vent cleaner kit|vacuum attachment|filter element|replacement rod|extension wand|cleaner head|floor tool|vacuum cleaner holder|vacuum cleaner hose|attachment accessories kit|dust bin replacement|floor brush head|vacuum cleaner main body|main body.{0,8}cyclone)\b/.test(sold);}
 if(id==="Q29")return /\b(?:miniature|miniatures|dollhouse|1:100|1 100)\b/.test(t)||(/\b(?:folding chair|student chair)\b/.test(t)&&!/\boffice chair\b/.test(t));
 if(id==="Q30"){const sold=t.split(/\bwith\b/,1)[0];return /\b(?:sagging fix clamp|height[- ]lock bracket|chair repair clamp|fix sinking chair kit|chair saver|replace swivel caster wheels|stationary foot|headrest attachment|head cushion pillow attachment|armrest cushions?|gas lift|chair spare parts|office chair mat|floor protectors|camping cot)\b/.test(sold)||(/\b(?:folding chair|student chair)\b/.test(sold)&&!/\boffice chair\b/.test(sold));}
 if(id==="Q31")return /\b(?:empty makeup sprayer|empty spray bottle|empty bottle|coffee beans sprayer)\b/.test(t);
 if(id==="Q32")return /\b(?:stickers?|coffee cup sticker|coffee mug|coffee cups|book of coffee|coffee filter|coffee cupping techniques|coffee art|coffee grinder|coffee dripper|barista tools|pour over premium coffee set|book for coffee lovers|little book for coffee lovers|treatise on the nature|coffee and poetry)\b/.test(t);
 if(id==="Q33")return /\b(?:braided sport loop|watch strap|watch band|wristbands?|band for apple watch|front glass replacement|tempered glass|tpu film)\b/.test(t)&&
   !/\b(?:gps smartwatch|smartwatch|watch body|watch series 11 gps)\b/.test(t);
 // Arabic Q20/Q22/Q34 are transport and product-title evidence only.
 return false;
}
export function evaluateObservedRow(id,groups){
 const rows=(Array.isArray(groups)?groups:[]).slice(0,10).map((g,i)=>{
   const o=g?.bestOffer||{},bad=knownWrongRetailSubject(id,o.title);
   let sourceHost=null,sourcePathDigest=null;
   try{const u=new URL(o.sourceUrl);
     if(u.protocol==="https:"&&!u.username&&!u.password){
       sourceHost=u.hostname;
       sourcePathDigest=createHash("sha256").update(u.pathname).digest("hex").slice(0,16);
     }}catch{}
   return {rank:i+1,title:short(o.title),merchant:short(o.merchant),
     sourceHost,sourcePathDigest,grade:bad?0:null,
     label:bad?"KNOWN_WRONG_SOLD_SUBJECT":"UNJUDGED"};
 });
 const bad=rows.filter(x=>x.grade===0);
 return {firstTen:rows,knownWrongRanks:bad.map(x=>x.rank),unjudged:rows.length-bad.length,
   state:bad.length?"KNOWN_WRONG_VISIBLE":rows.length?"OBSERVED_UNCERTIFIED":"NO_STRICT_GROUPS"};
}
async function fetchJson(path,ms=30000){
 const resp=await fetch(new URL(path,API),{headers:{accept:"application/json","cache-control":"no-cache"},
   redirect:"error",signal:AbortSignal.timeout(ms)});
 if(Number(resp.headers.get("content-length")||0)>MAX_BYTES)throw Error("DECLARED_BODY_TOO_LARGE");
 if(!resp.body)throw Error("MISSING_BODY");
 let bytes=0;const chunks=[];
 for await(const chunk of resp.body){
   bytes+=chunk.byteLength;
   if(bytes>MAX_BYTES)throw Error("BODY_TOO_LARGE");
   chunks.push(chunk);
 }
 return {http:resp.status,body:JSON.parse(Buffer.concat(chunks,bytes).toString("utf8"))};
}
async function health(expected){
 const r=await fetchJson("/health",20000);
 const item={http:r.http,ok:r.body?.ok===true,revision:r.body?.revision??null};
 if(item.http!==200||!item.ok||item.revision!==expected)throw Error("LIVE_SHA_MISMATCH");
 return item;
}
export async function runProductionAudit(){
 const expected=String(process.env.NAWAA_EXPECT_LIVE_SHA||"");
 const report={schemaVersion:"nawaa.r04.principal.postdeploy.v1",expectedSha:expected,
   startedAt:new Date().toISOString(),mode:"READ_ONLY_POSTDEPLOY_JSON",
   source:"FROZEN_CORPUS_AND_INDEPENDENT_PRECOMMITTED_NEGATIVE_LABELS",
   fullR04Certified:false,domParityVerified:false,humanAdjudicated:false,
   limitations:["Zero flagged known titles is not independently adjudicated precision.",
     "Empty strict groups are distinct from clean product matches.",
     "All offers are dynamic; no implied full-source recall, price or stock certification.",
     "API-based first-screen projection is not actual browser DOM/SSE parity."],
   healthBefore:null,healthAfter:null,rows:[],fatal:null};
 try{
   if(!/^[a-f0-9]{40}$/.test(expected))throw Error("EXPECTED_SHA_INVALID");
   const corpus=JSON.parse(readFileSync(new URL("../engineering/execution/search-truth-corpus.json",import.meta.url),"utf8"));
   const cases=CASE_IDS.map(id=>corpus.queryCases?.find(x=>x.id===id));
   if(cases.some(x=>!x?.query)||new Set(cases.map(x=>x.id)).size!==CASE_IDS.length)throw Error("CORPUS_MISMATCH");
   report.healthBefore=await health(expected);
   const rows=new Array(cases.length);let next=0;
   await Promise.all(Array.from({length:2},async()=>{
     while(next<cases.length){
       const index=next++,c=cases[index];
       const row={id:c.id,query:c.query,status:"NOT_RUN",offers:null,groups:null,
         sourceErrors:null,partial:null,pending:null,firstTen:[],knownWrongRanks:[],unjudged:0,state:null,reason:null};
       rows[index]=row;
       try{
         const {http,body}=await fetchJson("/api/search?q="+encodeURIComponent(c.query));
         if(http!==200||!Array.isArray(body?.offers))throw Error("BAD_SEARCH_RESPONSE");
         row.status="OBSERVED";row.offers=body.offers.length;
         row.partial=body.coverage?.partial===true;
         row.sourceErrors=Array.isArray(body.errors)?body.errors.length:null;
         row.pending=body.coverage?.providersPending??null;
         const intent=parseSearchIntent(c.query);
         const strict=groupComparableOffers(body.offers,"lowest").filter(g=>
           g.bestOffer?.exactMatch===true&&(g.bestOffer.matchConfidence||0)>=.9&&
           g.bestOffer.condition===(intent.condition||"new"));
         const groups=buildDiscoverySections(c.query,strict).flatMap(s=>s.groups.slice(0,10)).slice(0,10);
         row.groups=groups.length;
         Object.assign(row,evaluateObservedRow(c.id,groups));
       }catch(e){row.status="REQUEST_FAILED";row.reason=short(e?.name||"ERROR");}
       console.log("R04_PRINCIPAL_ROW "+JSON.stringify({id:row.id,status:row.status,
         groups:row.groups,knownWrongRanks:row.knownWrongRanks,
         partial:row.partial,sourceErrors:row.sourceErrors,reason:row.reason}));
     }
   }));
   report.rows=rows;
   report.healthAfter=await health(expected);
 }catch(e){report.fatal=short(e?.message||e);}
 const observed=report.rows.filter(x=>x.status==="OBSERVED");
 const wrong=observed.filter(x=>x.knownWrongRanks.length).map(x=>x.id);
 const missingCounters=observed.filter(x=>!Number.isSafeInteger(x.sourceErrors)).map(x=>x.id);
 const collected=report.rows.length===CASE_IDS.length&&observed.length===CASE_IDS.length&&
   report.healthBefore&&report.healthAfter&&!missingCounters.length;
 report.summary={attempted:report.rows.length,observed:observed.length,
   knownWrongCases:wrong,emptyStrictCases:observed.filter(x=>x.state==="NO_STRICT_GROUPS").map(x=>x.id),
   requestFailures:report.rows.filter(x=>x.status!=="OBSERVED").map(x=>x.id),
   missingSourceCounters:missingCounters,partialCases:observed.filter(x=>x.partial).length,
   sourceErrorEvents:observed.reduce((n,x)=>n+(x.sourceErrors||0),0),
   result:wrong.length?"KNOWN_WRONG_LIVE":collected?"EVIDENCE_COLLECTED_NOT_CERTIFIED":"COLLECTION_INCOMPLETE",
   fullR04Certified:false};
 report.completedAt=new Date().toISOString();
 writeFileSync("r04-principal-postdeploy-live.json",JSON.stringify(report,null,2)+"\n");
 console.log("R04_PRINCIPAL_SUMMARY "+JSON.stringify(report.summary));
 if(report.fatal||!collected||wrong.length)process.exitCode=1;
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runProductionAudit();
