// NAWAA R04-P48. Opt-in, bounded observations of existing PDP HTTPS calls.
// Each clock event denotes an observed boundary, never a causal explanation.
// No URL, query, SKU, body, title, price, address, secret, error string or header.
import {performance} from "node:perf_hooks";

export const PDP_MILESTONES=Object.freeze([
  "dns_complete","request_started","socket_assigned","tcp_connected",
  "tls_ready","headers_received","body_complete","candidates_extracted",
  "price_selected",
]);
const MILESTONES=new Set(PDP_MILESTONES);
const ERROR_CODES=new Set([
  "HTTP_TIMEOUT","HTTP_403_ACCESS_DENIED","HTTP_429_RATE_LIMITED",
  "HTTP_5XX_SOURCE_FAILURE","SOURCE_TRANSPORT_FAILURE",
  "SOURCE_ACCESS_DENIED_COOLDOWN","SOURCE_RATE_LIMIT_COOLDOWN",
  "HTTP_ABORTED","NO_VERIFIED_STRUCTURED_PRICE_PDP",
  "SOURCE_PRICE_PUBLICATION_HELD","UNKNOWN",
]);
const finite=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=120000;
const number=n=>finite(n)?Math.round(n):null;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000?n:null;
const quantile=(values,q)=>{
  const a=values.filter(finite).sort((x,y)=>x-y);
  return a.length?a[Math.max(0,Math.ceil(a.length*q)-1)]:null;
};
// Tracing is always bounded to one requested PDP. An HTTP redirect is marked
// as potentially multi-hop so internal steps are not falsely treated as one hop.
export function createPdpMilestoneProbe({now=()=>performance.now()}={}){
  const started=now(),milestones={},seen=new Set();
  let redirects=0,clockInvalid=false;
  return {
    mark(stage){
      if(stage==="redirect"){
        redirects=Math.min(8,redirects+1);
        return;
      }
      if(!MILESTONES.has(stage)||seen.has(stage))return;
      const offset=now()-started;
      if(!finite(offset)){clockInvalid=true;return;}
      seen.add(stage);
      milestones[stage]=Math.round(offset);
    },
    snapshot(){
      return {milestones:{...milestones},redirects,clockInvalid};
    },
    elapsedMs(){return number(now()-started);},
  };
}
export function summarizePdpAttemptPhases(attempts=[],{maxAttempts=20}={}){
  if(!Array.isArray(attempts)||!Number.isSafeInteger(maxAttempts)||
    maxAttempts<1||maxAttempts>20)throw Error("INVALID_PDP_TRACE_INPUT");
  const limited=attempts.slice(0,maxAttempts),sample={};
  const fields=[
    "dns","tcpHandshake","tlsHandshake","headerWait","bodyRead",
    "productExtraction","priceSelection","elapsed",
  ];
  for(const k of fields)sample[k]=[];
  const result={
    attempted:limited.length,omittedAttempts:Math.max(0,attempts.length-limited.length),
    succeeded:0,unpriced:0,rejected:0,timeout:0,
    parentCancelled:0,storeBudgetCancelled:0,independentTimeout:0,
    beforeDnsFailure:0,beforeHeadersFailure:0,afterHeadersFailure:0,
    multiHop:0,clockInconsistent:0,
    errorClasses:{},milestoneCounts:Object.fromEntries(PDP_MILESTONES.map(s=>[s,0])),
  };
  for(const item of limited){
    const raw=item?.milestones&&typeof item.milestones==="object"?item.milestones:{};
    const marks={};
    for(const stage of PDP_MILESTONES){
      const t=number(raw[stage]);
      if(t!==null){marks[stage]=t;result.milestoneCounts[stage]++;}
    }
    const kind=["succeeded","unpriced","rejected"].includes(item?.outcome)?
      item.outcome:"rejected";
    result[kind]++;
    if(item?.parentCancelled===true)result.parentCancelled++;
    if(item?.storeBudgetCancelled===true)result.storeBudgetCancelled++;
    const failureClass=ERROR_CODES.has(item?.failureClass)?item.failureClass:"UNKNOWN";
    if(kind==="rejected"){
      result.errorClasses[failureClass]=(result.errorClasses[failureClass]||0)+1;
      if(failureClass==="HTTP_TIMEOUT"){
        result.timeout++;
        if(item?.parentCancelled!==true)result.independentTimeout++;
      }
      if(marks.dns_complete===undefined)result.beforeDnsFailure++;
      else if(marks.headers_received===undefined)result.beforeHeadersFailure++;
      else result.afterHeadersFailure++;
    }
    if(count(item?.redirects)>0)result.multiHop++;
    const clockInvalid=item?.clockInvalid===true;
    const order=PDP_MILESTONES.filter(p=>marks[p]!==undefined).map(p=>marks[p]);
    if(clockInvalid||order.some((t,i)=>i>0&&t<order[i-1])){
      result.clockInconsistent++;
      continue;
    }
    // The per-request phases below require directly observed, compatible
    // milestone pairs; missing socket/TLS evidence NEVER becomes zero.
    const interval=(start,end)=>start!==undefined&&end!==undefined&&end>=start?
      end-start:null;
    const singleHop=!(count(item?.redirects)>0);
    const pair={
      dns:marks.dns_complete,
      tcpHandshake:singleHop?interval(marks.request_started,marks.tcp_connected):null,
      tlsHandshake:singleHop?interval(marks.tcp_connected,marks.tls_ready):null,
      headerWait:singleHop?interval(marks.tls_ready,marks.headers_received):null,
      bodyRead:singleHop?interval(marks.headers_received,marks.body_complete):null,
      productExtraction:singleHop?interval(marks.body_complete,marks.candidates_extracted):null,
      priceSelection:singleHop?interval(marks.candidates_extracted,marks.price_selected):null,
      elapsed:number(item?.totalMs),
    };
    for(const [k,v] of Object.entries(pair))if(v!==null)sample[k].push(v);
  }
  return {
    ...result,phaseMs:Object.fromEntries(fields.map(k=>[k,{
      observations:sample[k].length,p50:quantile(sample[k],.5),p95:quantile(sample[k],.95),
    }])),
    evidenceLevel:"OBSERVED_BOUNDARIES_NOT_CAUSAL_PROOF",
  };
}
// Strict pass-through whitelist also protects logs from untrusted callbacks.
export function safePdpPhaseSummary(summary){
  if(!summary||typeof summary!=="object")return null;
  const phaseMs={};
  for(const name of ["dns","tcpHandshake","tlsHandshake","headerWait","bodyRead",
    "productExtraction","priceSelection","elapsed"]){
    const phase=summary.phaseMs?.[name];
    phaseMs[name]={
      observations:count(phase?.observations),
      p50:number(phase?.p50),p95:number(phase?.p95),
    };
  }
  const errorClasses={};
  for(const key of ERROR_CODES)
    if(count(summary.errorClasses?.[key])!==null)errorClasses[key]=summary.errorClasses[key];
  const milestoneCounts={};
  for(const key of PDP_MILESTONES)
    milestoneCounts[key]=count(summary.milestoneCounts?.[key]);
  return {
    attempted:count(summary.attempted),omittedAttempts:count(summary.omittedAttempts),
    succeeded:count(summary.succeeded),unpriced:count(summary.unpriced),
    rejected:count(summary.rejected),timeout:count(summary.timeout),
    parentCancelled:count(summary.parentCancelled),
    storeBudgetCancelled:count(summary.storeBudgetCancelled),
    independentTimeout:count(summary.independentTimeout),
    beforeDnsFailure:count(summary.beforeDnsFailure),
    beforeHeadersFailure:count(summary.beforeHeadersFailure),
    afterHeadersFailure:count(summary.afterHeadersFailure),
    multiHop:count(summary.multiHop),clockInconsistent:count(summary.clockInconsistent),
    errorClasses,milestoneCounts,phaseMs,
    evidenceLevel:"OBSERVED_BOUNDARIES_NOT_CAUSAL_PROOF",
  };
}
