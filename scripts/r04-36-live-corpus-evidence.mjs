// R04 broad live evidence collection, NOT a product-truth certificate.
// Observes all 36 frozen bilingual corpus intents on exact production API.
// Concurrency=2; no retries, scraping, browser spoofing, secret or production writes.
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {groupComparableOffers} from "../src/search-core.mjs";
import {buildSearchPresentationSections} from "../src/search-result-presentation.mjs";
import {provisionalLabel} from "./verify-r04-live-ranking.mjs";
import {validateR04Corpus,summarizeR04Judgments,summarizeR04LiveEvidence} from "./r04-full-corpus-contract.mjs";
import {aggregateSourceErrorEvidence,mergeSourceErrorEvidence} from "./r04-source-failure-forensics.mjs";

const BASE="https://nawaa-search-api.onrender.com";
const EXPECTED=process.env.NAWAA_EXPECT_LIVE_SHA||"";
const LIMIT_BYTES=3_000_000,HTTP_TIMEOUT=30_000,CONCURRENCY=2;
const corpus=JSON.parse(readFileSync(new URL("../engineering/execution/search-truth-corpus.json",import.meta.url),"utf8"));
const knownKinds=new Map([
  ["Q01","iphone"],["Q02","iphone"],["Q03","galaxy"],["Q04","galaxy"],
  ["Q05","ps5"],["Q06","ps5"],["Q11","jbl"],["Q12","jbl"],
  ["Q15","laptop"],["Q16","laptop"],
]);
const hash=v=>createHash("sha256").update(String(v||"")).digest("hex");
const safe=v=>String(v??"").slice(0,180);
const report={
  schemaVersion:"nawaa.r04.36-live-corpus.v1",
  mode:"READ_ONLY_PUBLIC_EXACT_SHA",
  expectedSha:EXPECTED,startedAt:new Date().toISOString(),
  provenance:"FROZEN_INTENT_CORPUS_AND_PREDECLARED_PARTIAL_LEXICAL_RUBRIC",
  independentHumanAdjudication:false,fullRoundCertified:false,
  notEvidenceOf:["all merchants available","true cheapest price","independent human grading",
    "full 36-intent first-screen DOM parity","between-request JSON/SSE content equality",
    "global p95 latency"],
  healthBefore:null,healthAfter:null,rows:Array(36).fill(null),fatal:null,
};
async function fetchJson(path,timeoutMs=HTTP_TIMEOUT){
  const begin=performance.now();
  let phase="headers",headersMs=null,bodyMs=null;
  try {
    const response=await fetch(new URL(path,BASE),{headers:{accept:"application/json",
      "cache-control":"no-cache"},signal:AbortSignal.timeout(timeoutMs),redirect:"error"});
    headersMs=performance.now()-begin;
    phase="body";
    if(Number(response.headers.get("content-length")||0)>LIMIT_BYTES)
      throw Error("BODY_DECLARED_TOO_LARGE");
    const bodyStarted=performance.now();
    const bytes=await response.arrayBuffer();
    bodyMs=performance.now()-bodyStarted;
    if(bytes.byteLength>LIMIT_BYTES)throw Error("BODY_TOO_LARGE");
    phase="parse";
    const parseStarted=performance.now();
    const body=JSON.parse(new TextDecoder().decode(bytes));
    return {status:response.status,body,
      elapsedMs:Math.round(performance.now()-begin),responseBytes:bytes.byteLength,
      responsePhasesMs:{headers:Math.round(headersMs),body:Math.round(bodyMs),
        parse:Math.round(performance.now()-parseStarted)}};
  }catch(error){
    // Emit the safe lifecycle phase and elapsed wall clock, not the raw error
    // message/URL. In particular, a 30s timeout might be headers or body wait.
    const observed=new Error("r04_probe_failed");
    observed.name=error?.name||"Error";
    observed.phase=phase;
    observed.elapsedMs=Math.round(performance.now()-begin);
    throw observed;
  }
}
async function health(){
  const response=await fetchJson("/health",20000);
  const result={http:response.status,ok:response.body?.ok===true,
    revision:response.body?.revision??null};
  if(result.http!==200||!result.ok||result.revision!==EXPECTED)
    throw Error("PRODUCTION_REVISION_MISMATCH");
  return result;
}
function publicSourceRef(value){
  try{
    const u=new URL(value);
    if(u.protocol!=="https:"||u.username||u.password)return {host:null,pathHash:null};
    return {host:u.hostname,pathHash:hash(u.pathname).slice(0,16)};
  }catch{return {host:null,pathHash:null};}
}
async function probe(q){
  const probeStarted=Date.now();
  const row={id:q.id,language:q.language,group:q.group,query:q.query,
    status:"NOT_RUN",offers:0,groupCount:0,firstTen:[],judgments:null,partial:null,
    sourceErrors:null,sourceFailureTypes:null,sourceErrorBreakdown:null,pending:null,cacheMode:null,
    failurePhase:null,responsePhasesMs:null,responseBytes:null,catalogRecallStatus:null,
    elapsedMs:null,serverDurationMs:null,deadlineExceeded:null,
    primaryGroups:null,relatedGroups:null,presentedGroups:null,
    relatedLanes:null,firstRelated:[],reason:null};
  try{
    const response=await fetchJson("/api/search?q="+encodeURIComponent(q.query));
    row.elapsedMs=response.elapsedMs;
    row.responsePhasesMs=response.responsePhasesMs;
    row.responseBytes=response.responseBytes;
    if(response.status!==200||!Array.isArray(response.body?.offers))
      throw Error("INVALID_SEARCH_RESPONSE");
    const body=response.body;
    row.status="OBSERVED";row.offers=body.offers.length;
    row.partial=body.coverage?.partial===true;
    row.sourceErrors=Array.isArray(body.errors)?body.errors.length:null;
    row.pending=body.coverage?.providersPending??null;
    row.cacheMode=body.cache?.mode??null;
    row.serverDurationMs=Number.isFinite(body.durationMs)?body.durationMs:null;
    row.deadlineExceeded=body.coverage?.deadlineExceeded===true;
    row.catalogRecallStatus=["failed","success","unconfigured","skipped"].includes(
      body.coverage?.catalogRecall?.status)?body.coverage.catalogRecall.status:null;
    row.sourceFailureTypes=body.coverage?.sourceFailures?.types??null;
    row.sourceErrorBreakdown=aggregateSourceErrorEvidence(body.errors);
    const allGroups=groupComparableOffers(body.offers,"lowest");
    row.groupCount=allGroups.length;
    // Precisely the same partition used by src/search-page.mjs, not an
    // independently invented strict-threshold surrogate for the customer UI.
    const presentation=buildSearchPresentationSections(q.query,allGroups);
    const {discoverySections,exactGroups,secondarySections,relatedGroups,
      partitionedGroups}=presentation;
    if(partitionedGroups!==allGroups.length)
      throw Error("PRESENTATION_PARTITION_LOSS");
    row.primaryGroups=exactGroups.length;
    row.relatedGroups=relatedGroups.length;
    row.presentedGroups=partitionedGroups;
    row.relatedLanes=Object.fromEntries(secondarySections.map(section=>
      [section.key,section.groups.length]));
    // Preserve an inspectable, bounded sample of alternatives. Never promote
    // these into ranking metrics for certified principal matches.
    row.firstRelated=relatedGroups.slice(0,3).map(group=>({
      title:safe(group.bestOffer?.title),
      merchant:safe(group.bestOffer?.merchant),
    }));
    const firstTen=discoverySections.flatMap(s=>s.groups.slice(0,10)).slice(0,10);
    const kind=knownKinds.get(q.id)||null;
    row.firstTen=firstTen.map((group,rank)=>{
      const offer=group.bestOffer||{};
      const label=kind?provisionalLabel(kind,offer):
        {grade:null,reason:"CATEGORY_AWAITS_INDEPENDENT_PRODUCT_JUDGMENT"};
      const source=publicSourceRef(offer.sourceUrl);
      return {rank:rank+1,title:safe(offer.title),merchant:safe(offer.merchant),
        model:safe(offer.specs?.modelNumber),ram:safe(offer.specs?.ram),
        storage:safe(offer.specs?.storage),sourceHost:source.host,
        sourcePathDigest:source.pathHash,judgment:label};
    });
    row.judgments=summarizeR04Judgments(row.firstTen.map(x=>x.judgment));
    if(!firstTen.length)
      row.reason=relatedGroups.length
        ?"NO_VERIFIED_PRINCIPAL_RELATED_RESULTS_PRESENT"
        :"NO_PRESENTED_RESULT_GROUPS";
  }catch(e){
    row.status="REQUEST_FAILED";row.reason=safe(e?.name||"UNKNOWN_ERROR");
    row.failurePhase=safe(e?.phase||"response_validation");
    row.elapsedMs=Number.isFinite(e?.elapsedMs)?e.elapsedMs:Date.now()-probeStarted;
  }
  console.log("R04_36_QUERY "+JSON.stringify({id:row.id,status:row.status,offers:row.offers,
    groups:row.groupCount,primaryGroups:row.primaryGroups,
    relatedGroups:row.relatedGroups,relatedLanes:row.relatedLanes,
    visible:row.firstTen.length,judged:row.judgments?.judged??0,
    unjudged:row.judgments?.unjudged??0,metric:row.judgments?.status,
    partial:row.partial,sourceErrors:row.sourceErrors,
    sourceFailureTypes:row.sourceFailureTypes,
    sourceFailureLeaders:row.sourceErrorBreakdown?.buckets?.slice(0,3)??null,
    failurePhase:row.failurePhase,serverDurationMs:row.serverDurationMs,
    responsePhasesMs:row.responsePhasesMs,responseBytes:row.responseBytes,
    catalogRecallStatus:row.catalogRecallStatus,
    deadlineExceeded:row.deadlineExceeded,elapsedMs:row.elapsedMs,
    reason:row.reason}));
  return row;
}
try{
  if(!/^[a-f0-9]{40}$/.test(EXPECTED))throw Error("EXPECTED_SHA_INVALID");
  const corpusStatus=validateR04Corpus(corpus);
  if(!corpusStatus.pass)throw Error("FROZEN_CORPUS_INVALID_"+corpusStatus.reason);
  report.healthBefore=await health();
  let next=0;
  await Promise.all(Array.from({length:CONCURRENCY},async()=>{
    while(next<corpus.queryCases.length){
      const index=next++;
      report.rows[index]=await probe(corpus.queryCases[index]);
    }
  }));
  report.healthAfter=await health();
}catch(e){report.fatal=safe(e?.message||e);console.log("R04_36_FATAL "+report.fatal);}
report.completedAt=new Date().toISOString();
report.summary=summarizeR04LiveEvidence(report.rows.filter(Boolean),{
  expectedSha:EXPECTED,observedSha:report.healthAfter?.revision??null,
});
report.summary.sourceFailureAttribution=mergeSourceErrorEvidence(report.rows.map(x=>x?.sourceErrorBreakdown));
report.summary.resultsWithoutStrictUiGroups=report.rows.filter(x=>x?.status==="OBSERVED"&&
  x.primaryGroups===0).map(x=>x.id);
report.summary.resultsWithOnlyRelatedGroups=report.rows.filter(x=>
  x?.status==="OBSERVED"&&x.primaryGroups===0&&x.relatedGroups>0).map(x=>x.id);
report.summary.resultsWithNoPresentedGroups=report.rows.filter(x=>
  x?.status==="OBSERVED"&&x.presentedGroups===0).map(x=>x.id);
report.summary.partitionedWithoutLoss=report.rows.every(x=>
  x?.status!=="OBSERVED"||x.presentedGroups===x.groupCount);
report.summary.observedOffers=report.rows.reduce((n,x)=>n+(x?.offers||0),0);
report.summary.corpusFrozen=validateR04Corpus(corpus).pass;
report.summary.result=!report.fatal&&report.summary.evidenceCollected?"EVIDENCE_COLLECTED":"COLLECTION_FAILED";
writeFileSync("r04-36-live-corpus-evidence.json",JSON.stringify(report,null,2)+"\n");
console.log("R04_36_SUMMARY "+JSON.stringify(report.summary));
if(report.summary.result!=="EVIDENCE_COLLECTED")process.exitCode=1;
