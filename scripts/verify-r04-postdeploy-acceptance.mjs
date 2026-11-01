// Read-only production acceptance after merged R04. No production writes.
// Quality labels are independent of system scores, price, exactMatch and rank.
import { writeFileSync } from "node:fs";
import { groupComparableOffers } from "../src/search-core.mjs";
import { provisionalLabel } from "./verify-r04-live-ranking.mjs";

const EXPECTED=String(process.env.NAWAA_EXPECT_LIVE_SHA||"");
const ORIGIN="https://nawaa-search-api.onrender.com";
const MAX_BYTES=3_000_000;
const TARGETS=[
  ["Q03","Samsung Galaxy S25 Ultra","galaxy"],
  ["Q04","سامسونج جالكسي S25 الترا","galaxy"],
  ["Q15","HP laptop 16GB RAM","laptop"],
  ["Q16","لابتوب اتش بي 16 رام","laptop"],
];
const compact=v=>String(v??"").slice(0,280);

async function loadJson(path,timeoutMs=26000){
  const resp=await fetch(new URL(path,ORIGIN),{
    headers:{accept:"application/json","cache-control":"no-cache"},
    redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
  const declared=Number(resp.headers.get("content-length")||0);
  if(declared>MAX_BYTES)throw Error("RESPONSE_LIMIT_HEADER");
  const bytes=await resp.arrayBuffer();
  if(bytes.byteLength>MAX_BYTES)throw Error("RESPONSE_LIMIT_BODY");
  return {status:resp.status,body:JSON.parse(new TextDecoder().decode(bytes))};
}

const evidence={
  schemaVersion:"nawaa.r04.production.acceptance.v1",
  mode:"READ_ONLY_LIVE_POSTDEPLOY",
  expectedSha:EXPECTED,
  startedAt:new Date().toISOString(),
  provisionalLabels:true,
  uiParityVerified:false,
  scope:"Q03_Q04_Q15_Q16_DEPTH0",
  health:null,queries:[],fatal:null,
};
let failed=false;
try{
  if(!/^[0-9a-f]{40}$/.test(EXPECTED))throw Error("EXPECTED_SHA_INVALID");
  const health=await loadJson("/health",60000);
  evidence.health={status:health.status,ok:health.body?.ok===true,revision:health.body?.revision??null};
  if(health.status!==200||!evidence.health.ok||evidence.health.revision!==EXPECTED)
    throw Error("LIVE_SHA_MISMATCH");
  console.log("POSTDEPLOY_R04_HEALTH "+JSON.stringify(evidence.health));
  for(const [id,query,kind] of TARGETS){
    const item={id,query,kind,status:"NOT_RUN",topTen:[],offers:null,groups:null,
      partial:null,sourceErrors:null,failedReasons:[]};
    evidence.queries.push(item);
    try{
      const result=await loadJson("/api/search?q="+encodeURIComponent(query));
      if(result.status!==200||!Array.isArray(result.body?.offers))
        throw Error("SEARCH_RESPONSE_INVALID");
      const groups=groupComparableOffers(result.body.offers);
      item.status="OBSERVED";
      item.offers=result.body.offers.length;
      item.groups=groups.length;
      item.partial=result.body?.coverage?.partial===true;
      item.sourceErrors=Array.isArray(result.body?.errors)?result.body.errors.length:null;
      item.topTen=groups.slice(0,10).map((group,idx)=>{
        const offer=group.bestOffer||{};
        return {
          rank:idx+1,title:compact(offer.title),merchant:compact(offer.merchant),
          sourceUrl:compact(offer.sourceUrl),ram:compact(offer.specs?.ram),
          systemExact:offer.exactMatch===true,
          systemConfidence:Number.isFinite(offer.matchConfidence)?offer.matchConfidence:null,
          judgment:provisionalLabel(kind,offer),
        };
      });
      if(!item.topTen.length)item.failedReasons.push("EMPTY_RANKED_RESULTS");
      if(item.topTen[0]?.judgment?.grade!==3)item.failedReasons.push("TOP1_NOT_STRICTLY_CONFIRMED");
      const forbidden=item.topTen.filter(x=>x.judgment.grade===0);
      if(forbidden.length)item.failedReasons.push("PROVEN_WRONG_VARIANT_OR_ACCESSORY_IN_TOP10");
      const unjudged=item.topTen.filter(x=>!Number.isInteger(x.judgment.grade));
      if(unjudged.length)item.failedReasons.push("UNJUDGED_TOP10");
      // A partial multi-source response cannot be silently called complete.
      // Record partial coverage as a separate reliability finding; this gate
      // certifies ranking of observed offers, not exhaustive merchant coverage.
      console.log("POSTDEPLOY_R04_QUERY "+JSON.stringify({
        id,status:item.status,offers:item.offers,groups:item.groups,
        rank1:item.topTen[0]||null,forbiddenRanks:forbidden.map(x=>x.rank),
        unjudgedRanks:unjudged.map(x=>x.rank),partial:item.partial,
        sourceErrors:item.sourceErrors,failedReasons:item.failedReasons,
      }));
    }catch(error){
      item.status="REQUEST_FAILED";
      item.failedReasons.push("REQUEST_FAILED");
      item.failureCode=compact(error?.name||"ERROR");
      console.log("POSTDEPLOY_R04_QUERY_FAILURE "+JSON.stringify({
        id,status:item.status,failureCode:item.failureCode,
      }));
    }
    if(item.failedReasons.length)failed=true;
  }
}catch(error){
  failed=true;
  evidence.fatal=compact(error?.message||"ERROR");
  console.log("POSTDEPLOY_R04_FATAL "+evidence.fatal);
}
evidence.completedAt=new Date().toISOString();
evidence.summary={
  checked:evidence.queries.length,
  observed:evidence.queries.filter(x=>x.status==="OBSERVED").length,
  passed:evidence.queries.filter(x=>x.status==="OBSERVED"&&!x.failedReasons.length).length,
  partial:evidence.queries.filter(x=>x.partial===true).length,
  failed,
  fatal:evidence.fatal,
};
writeFileSync("r04-postdeploy-production-acceptance.json",
  JSON.stringify(evidence,null,2)+"\n");
console.log("POSTDEPLOY_R04_SUMMARY "+JSON.stringify(evidence.summary));
if(failed||evidence.summary.checked!==TARGETS.length||evidence.summary.passed!==TARGETS.length)
  process.exitCode=1;
