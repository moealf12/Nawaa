// R04-P45: deterministic, evidence-first diagnosis of REAL production audit data.
// Pure computation: no network, credentials, merchant traffic, mutation, or ML guesswork.
// Outputs IDs and bounded numeric / predefined diagnostic codes only.
const SHA=/^[a-f0-9]{40}$/;
const INTENT=/^Q(?:0[1-9]|[12][0-9]|3[0-6])$/;
const PHASES=new Set(["headers","body","parse","response_validation"]);
const CODE_TO_PROBE=Object.freeze({
  REQUEST_TRANSPORT_FAILURE:"PROBE_CLIENT_HEADERS_BODY_BOUNDARY",
  RESPONSE_PARSE_FAILURE:"PROBE_RESPONSE_CONTENT_TYPE_AND_SIZE",
  RESPONSE_CONTRACT_FAILURE:"PROBE_JSON_CONTRACT_AND_HTTP_STATUS",
  NO_VERIFIED_OFFERS:"TRACE_SOURCE_ROUTE_TO_ADMISSION",
  PRINCIPAL_PRESENTATION_GAP:"TRACE_ACQUISITION_MATCHING_PRESENTATION",
  PRINCIPAL_UNCLASSIFIED_GAP:"TRACE_GROUP_PARTITION_AND_MATCHING",
  INTERNAL_DEADLINE:"TRACE_PROVIDER_BUDGET_QUEUE_AND_EVENT_LOOP",
  SOURCE_ACCESS_BLOCK:"AUDIT_OBSERVED_MERCHANT_ACCESS_EVIDENCE",
  SOURCE_TIMEOUT:"TRACE_UPSTREAM_REQUEST_PHASE_AND_DEADLINE",
  CATALOG_RECALL_FAILURE:"TRACE_CATALOG_RECALL_PHASE_AND_ERROR_CLASS",
  SOURCE_ERROR_ACCOUNTING_GAP:"RECHECK_LOSSLESS_ERROR_CLASSIFICATION",
  INCONSISTENT_TIMING_EVIDENCE:"RECHECK_CLOCK_AND_MEASUREMENT_BOUNDARIES",
  CLIENT_HEADER_WAIT_DOMINANT:"TRACE_RENDER_ADMISSION_AND_PRE_HEADER_CRITICAL_PATH",
  CLIENT_BODY_READ_DOMINANT:"TRACE_RESPONSE_STREAM_AND_TRANSFER_PATH",
  CLIENT_PARSE_COST_DOMINANT:"PROFILE_LARGE_JSON_PARSE_AND_RESPONSE_SIZE",
  COVERAGE_EVIDENCE_MISSING:"TRACE_SOURCE_WAVE_COMPLETENESS_CONTRACT",
  COVERAGE_CONTRADICTION:"TRACE_PARTIAL_COVERAGE_ADMISSION_CONTRACT",
  REQUEST_EVIDENCE_MISSING:"RECOLLECT_MISSING_INTENT_WITH_SHA_GUARD",
});
const sourceBlock=new Set([
  "HTTP_403_ACCESS_DENIED","HTTP_429_RATE_LIMITED",
  "HTTP_200_BLOCK_PAGE","HTTP_200_JS_SHELL",
  "SOURCE_ACCESS_DENIED_COOLDOWN","SOURCE_RATE_LIMIT_COOLDOWN",
]);
const sourceTimeout=new Set(["HTTP_TIMEOUT","SOURCE_TRANSPORT_FAILURE"]);
const finiteNonnegative=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=120000;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000?n:null;
function quantile(samples,p){
  if(!samples.length)return null;
  const x=[...samples].sort((a,b)=>a-b);
  return x[Math.max(0,Math.ceil(p*x.length)-1)];
}
function mark(list,code,kind="OBSERVED_SYMPTOM"){
  if(!list.some(x=>x.code===code))
    list.push({code,kind,nextProbe:CODE_TO_PROBE[code]});
}
function validateProvenance(report){
  if(!report||report.schemaVersion!=="nawaa.r04.36-live-corpus.v1")
    throw Error("DIAGNOSTIC_SCHEMA_INVALID");
  if(!SHA.test(report.expectedSha||""))throw Error("DIAGNOSTIC_SHA_INVALID");
  if(!Array.isArray(report.rows)||report.rows.length!==36)
    throw Error("DIAGNOSTIC_CORPUS_SHAPE_INVALID");
  if(report.healthBefore?.revision!==report.expectedSha||
     report.healthAfter?.revision!==report.expectedSha||
     report.healthBefore?.ok!==true||report.healthAfter?.ok!==true)
    throw Error("DIAGNOSTIC_PROVENANCE_NOT_VERIFIED");
}
export function diagnoseR04Evidence(report){
  validateProvenance(report);
  const seen=new Set(), rows=[],latency=[],codes=new Map();
  const headerSamples=[],bodySamples=[],parseSamples=[],bytesSamples=[],serverSamples=[];
  let observed=0,partial=0,missingPrincipal=0,deadlineCount=0,failed=0;
  let errorEvents=0,unattributedEvents=0;
  for(let i=0;i<36;i++){
    const row=report.rows[i];
    const id=row?.id;
    if(!INTENT.test(id||"")||seen.has(id))
      throw Error("DIAGNOSTIC_INTENT_ID_INVALID");
    seen.add(id);
    const flags=[];
    const status=row.status==="OBSERVED"?"OBSERVED":
      row.status==="REQUEST_FAILED"?"REQUEST_FAILED":"EVIDENCE_MISSING";
    const timing=finiteNonnegative(row.elapsedMs)?Math.round(row.elapsedMs):null;
    if(timing!==null&&status==="OBSERVED")latency.push(timing);
    if(status==="REQUEST_FAILED"){
      failed++;
      const phase=PHASES.has(row.failurePhase)?row.failurePhase:null;
      mark(flags,phase==="parse"?"RESPONSE_PARSE_FAILURE":
        phase==="response_validation"?"RESPONSE_CONTRACT_FAILURE":"REQUEST_TRANSPORT_FAILURE");
    }else if(status==="EVIDENCE_MISSING"){
      mark(flags,"REQUEST_EVIDENCE_MISSING");
    }else{
      observed++;
      if(row.partial===true)partial++;
      else if(row.partial!==false)mark(flags,"COVERAGE_EVIDENCE_MISSING");
      if(row.partial===false&&count(row.sourceErrors)>0)
        mark(flags,"COVERAGE_CONTRADICTION");
      const offers=count(row.offers),principal=count(row.primaryGroups);
      if(principal===0){
        missingPrincipal++;
        if(offers===0)mark(flags,"NO_VERIFIED_OFFERS");
        else if(count(row.relatedGroups)>0)mark(flags,"PRINCIPAL_PRESENTATION_GAP");
        else mark(flags,"PRINCIPAL_UNCLASSIFIED_GAP");
      }else if(principal===null)mark(flags,"REQUEST_EVIDENCE_MISSING");
      if(row.deadlineExceeded===true){
        deadlineCount++;
        mark(flags,"INTERNAL_DEADLINE");
      }
      const catalog=row.catalogRecallStatus;
      if(catalog==="failed"){
        mark(flags,"CATALOG_RECALL_FAILURE");
        if(row.partial===false)mark(flags,"COVERAGE_CONTRADICTION");
      }
      if(finiteNonnegative(row.serverDurationMs))
        serverSamples.push(Math.round(row.serverDurationMs));
      if(count(row.responseBytes)!==null)bytesSamples.push(row.responseBytes);
      const breaks=row.sourceErrorBreakdown;
      if(breaks&&typeof breaks==="object"){
        const reported=count(breaks.reported);
        const other=count(breaks.otherEvents);
        const buckets=Array.isArray(breaks.buckets)?breaks.buckets:[];
        let measured=0;
        for(const b of buckets.slice(0,32)){
          const amount=count(b?.count);
          if(amount===null){mark(flags,"SOURCE_ERROR_ACCOUNTING_GAP");continue;}
          measured+=amount;
          if(sourceBlock.has(b?.failureClass))mark(flags,"SOURCE_ACCESS_BLOCK");
          if(sourceTimeout.has(b?.failureClass))mark(flags,"SOURCE_TIMEOUT");
        }
        if(reported===null||other===null||measured+other!==reported||
           (count(row.sourceErrors)!==null&&row.sourceErrors!==reported))
          mark(flags,"SOURCE_ERROR_ACCOUNTING_GAP");
        if(reported!==null)errorEvents+=reported;
        if(other!==null)unattributedEvents+=other;
      }else if(count(row.sourceErrors)>0)mark(flags,"SOURCE_ERROR_ACCOUNTING_GAP");
      const phases=row.responsePhasesMs;
      if(phases&&timing!==null){
        const h=phases.headers,b=phases.body,p=phases.parse;
        if(![h,b,p].every(finiteNonnegative)||h+b+p>timing+50)
          mark(flags,"INCONSISTENT_TIMING_EVIDENCE");
        else{
          headerSamples.push(h);bodySamples.push(b);parseSamples.push(p);
          // Observed CLIENT phases, never alleged merchant or server root causes.
          if(timing>=5000&&h>=4000&&h/timing>=.7)
            mark(flags,"CLIENT_HEADER_WAIT_DOMINANT");
          if(timing>=3000&&b>=1500&&b/timing>=.4)
            mark(flags,"CLIENT_BODY_READ_DOMINANT");
          if(timing>=1000&&p>=500&&p/timing>=.15)
            mark(flags,"CLIENT_PARSE_COST_DOMINANT");
        }
      }
    }
    // A failure can coexist with other observed symptoms; never infer a single
    // root cause from correlations or imply an inaccessible item is unavailable.
    for(const flag of flags)codes.set(flag.code,(codes.get(flag.code)||0)+1);
    rows.push({
      id,status,elapsedMs:timing,
      offers:status==="OBSERVED"?count(row.offers):null,
      principalGroups:status==="OBSERVED"?count(row.primaryGroups):null,
      sourceErrors:status==="OBSERVED"?count(row.sourceErrors):null,
      signals:flags,
    });
  }
  const order=Object.keys(CODE_TO_PROBE);
  const investigations=[...codes.entries()].map(([code,affectedIntents])=>({
    code,affectedIntents,nextProbe:CODE_TO_PROBE[code],
    // Triage order, not a probability or causal estimate.
    priorityPoints:affectedIntents*(
      ["NO_VERIFIED_OFFERS","REQUEST_TRANSPORT_FAILURE",
       "PRINCIPAL_PRESENTATION_GAP","PRINCIPAL_UNCLASSIFIED_GAP"].includes(code)?10:
      ["INTERNAL_DEADLINE","CATALOG_RECALL_FAILURE",
       "SOURCE_ERROR_ACCOUNTING_GAP"].includes(code)?7:3),
  })).sort((a,b)=>b.priorityPoints-a.priorityPoints||
    order.indexOf(a.code)-order.indexOf(b.code));
  const sampleP50Ms=quantile(latency,.5),sampleP95Ms=quantile(latency,.95);
  const totalErrorCounter=count(report.summary?.sourceErrorEvents);
  const reconciliation=totalErrorCounter===null?"UNKNOWN":
    totalErrorCounter===errorEvents?"MATCH":"MISMATCH";
  return {
    schemaVersion:"nawaa.r04.causal-diagnostic.v1",
    classification:"OBSERVATIONAL_TRIAGE_NOT_CAUSAL_PROOF",
    provenance:{expectedSha:report.expectedSha,preHealthSha:report.healthBefore.revision,
      postHealthSha:report.healthAfter.revision,corpusIntents:36,observed,
      requestFailed:failed,evidenceMissing:36-observed-failed},
    sample:{validLatencyObservations:latency.length,sampleP50Ms,sampleP95Ms,
      phaseSamples:headerSamples.length,
      clientHeadersP50Ms:quantile(headerSamples,.5),clientHeadersP95Ms:quantile(headerSamples,.95),
      clientBodyP50Ms:quantile(bodySamples,.5),clientBodyP95Ms:quantile(bodySamples,.95),
      clientParseP50Ms:quantile(parseSamples,.5),clientParseP95Ms:quantile(parseSamples,.95),
      responseBytesP95:quantile(bytesSamples,.95),
      serverReportedDurationP95Ms:quantile(serverSamples,.95),
      internalDeadlines:deadlineCount,missingPrincipal,partial,
      sourceErrorEvents:errorEvents,sourceErrorEventsOutsideTop32:unattributedEvents,
      sourceErrorReconciliation:reconciliation},
    investigations,rows,
    limitations:[
      "Observed source failures do not establish merchant inventory absence.",
      "A principal presentation gap cannot distinguish absent retrieval from matching error without stage traces.",
      "A sample P95 is not a traffic-wide tail-latency SLO.",
      "Top-32 failure buckets are truncated; unattributed events are not zero.",
      "No request-scoped causal critical path is claimed without end-to-end correlated server spans.",
    ],
  };
}
