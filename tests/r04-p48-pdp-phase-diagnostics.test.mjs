import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createPdpMilestoneProbe,summarizePdpAttemptPhases,safePdpPhaseSummary}
  from "../server/pdp-phase-diagnostics.mjs";

function timeline(entries,{outcome="rejected",failureClass="HTTP_TIMEOUT",redirects=0}={}){
  return {milestones:entries,redirects,clockInvalid:false,totalMs:6500,
    outcome,failureClass};
}
test("captures monotonic TCP/TLS/HTTP boundaries and never infers undocumented spans",()=>{
  let now=0;
  const probe=createPdpMilestoneProbe({now:()=>now});
  for(const [stage,time] of [["dns_complete",30],["request_started",32],
    ["socket_assigned",35],["tcp_connected",80],["tls_ready",145],
    ["headers_received",380],["body_complete",550],
    ["candidates_extracted",555],["price_selected",600]]){
    now=time;probe.mark(stage);
  }
  now=650;
  assert.equal(probe.elapsedMs(),650);
  const summary=summarizePdpAttemptPhases([{
    ...probe.snapshot(),totalMs:probe.elapsedMs(),outcome:"succeeded",
  }]);
  assert.equal(summary.succeeded,1);
  assert.equal(summary.phaseMs.dns.p95,30);
  assert.equal(summary.phaseMs.tcpHandshake.p95,48);
  assert.equal(summary.phaseMs.tlsHandshake.p95,65);
  assert.equal(summary.phaseMs.headerWait.p95,235);
  assert.equal(summary.phaseMs.bodyRead.p95,170);
  assert.equal(summary.phaseMs.productExtraction.p95,5);
  assert.equal(summary.phaseMs.priceSelection.p95,45);
  assert.equal(summary.timeout,0);
});
test("failures before headers are distinct from responses that fail parsing",()=>{
  const noHeaders=timeline({dns_complete:10,request_started:11,
    socket_assigned:12,tcp_connected:60,tls_ready:140});
  const afterHeaders=timeline({dns_complete:3,request_started:4,
    headers_received:100,body_complete:110});
  const dns=timeline({});
  const s=summarizePdpAttemptPhases([noHeaders,afterHeaders,dns]);
  assert.equal(s.timeout,3);
  assert.equal(s.beforeHeadersFailure,1);
  assert.equal(s.afterHeadersFailure,1);
  assert.equal(s.beforeDnsFailure,1);
  assert.equal(s.phaseMs.headerWait.observations,0);
  assert.equal(s.phaseMs.headerWait.p95,null);
});
test("parent budget cancellation is not automatically a merchant socket timeout",()=>{
  const s=summarizePdpAttemptPhases([
    {...timeline({dns_complete:3,request_started:4,socket_assigned:5,
      tcp_connected:15,tls_ready:55},{outcome:"rejected"}),
      parentCancelled:true,storeBudgetCancelled:true},
    {...timeline({dns_complete:3,request_started:4,tcp_connected:40,tls_ready:75},
      {outcome:"rejected"}),parentCancelled:false,storeBudgetCancelled:false},
  ]);
  assert.equal(s.timeout,2);
  assert.equal(s.parentCancelled,1);
  assert.equal(s.storeBudgetCancelled,1);
  assert.equal(s.independentTimeout,1);
  assert.equal(s.beforeHeadersFailure,2);
  const out=safePdpPhaseSummary(s);
  assert.equal(out.storeBudgetCancelled,1);
  assert.equal(out.independentTimeout,1);
});
test("redirects block single-hop phase durations, but retain observed boundaries",()=>{
  const s=summarizePdpAttemptPhases([
    timeline({dns_complete:2,request_started:3,tcp_connected:5,tls_ready:8,
      headers_received:9,body_complete:12},{redirects:1}),
  ]);
  assert.equal(s.multiHop,1);
  assert.equal(s.phaseMs.headerWait.observations,0);
  assert.equal(s.phaseMs.bodyRead.observations,0);
  assert.equal(s.milestoneCounts.headers_received,1);
});
test("invalid timestamps and duplicated milestones cannot yield fabricated latency",()=>{
  let now=0;
  const probe=createPdpMilestoneProbe({now:()=>now});
  now=5;probe.mark("dns_complete");
  now=70;probe.mark("dns_complete");
  now=-1;probe.mark("request_started");
  const snap=probe.snapshot();
  assert.equal(snap.milestones.dns_complete,5);
  assert.equal(snap.clockInvalid,true);
  const s=summarizePdpAttemptPhases([{...snap,outcome:"rejected",totalMs:1}]);
  assert.equal(s.clockInconsistent,1);
  assert.equal(s.phaseMs.dns.observations,0);
  const bad=summarizePdpAttemptPhases([timeline({
    dns_complete:40,request_started:30,tls_ready:29,headers_received:10,
  })]);
  assert.equal(bad.clockInconsistent,1);
  assert.equal(bad.phaseMs.headerWait.observations,0);
});
test("no transport input, PII, raw errors, merchant hostnames or prices leak",()=>{
  const summary=summarizePdpAttemptPhases([{
    ...timeline({dns_complete:30,request_started:40,tls_ready:60},
      {failureClass:"HTTP_TIMEOUT"}),
    url:"https://shop.test/p?access_token=SECRET",
    title:"Secret product",query:"name@example.com",price:999999,
    error:"Authorization Bearer SECRET",
  }]);
  const output=safePdpPhaseSummary({...summary,
    someRawField:"SECRET",errorClasses:{...summary.errorClasses,
      "SECRET ACCESS TOKEN":5}});
  const raw=JSON.stringify(output);
  for(const value of ["shop.test","SECRET","name@example.com","999999",
    "Secret product","Authorization"])assert.ok(!raw.includes(value),value);
  assert.equal(output.errorClasses["SECRET ACCESS TOKEN"],undefined);
});
test("bounded attempt count, missing milestones and selected unknowns are explicit",()=>{
  const attempts=Array.from({length:40},()=>timeline({dns_complete:10,
    request_started:12},{outcome:"rejected"}));
  const s=summarizePdpAttemptPhases(attempts);
  assert.equal(s.attempted,20);
  assert.equal(s.omittedAttempts,20);
  assert.equal(s.phaseMs.headerWait.p95,null);
  assert.equal(s.milestoneCounts.headers_received,0);
  assert.throws(()=>summarizePdpAttemptPhases("invalid"),
    /INVALID_PDP_TRACE_INPUT/);
});
test("resolver instrumentation stays optional and does not create new PDP calls",()=>{
  const resolver=readFileSync(new URL("../server/url-resolver.mjs",import.meta.url),"utf8");
  const provider=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
  assert.match(resolver,/emitPdp\(onPdpStage,"dns_complete"\)/);
  assert.match(resolver,/emitPdp\(onPdpStage,"headers_received"\)/);
  assert.match(resolver,/emitPdp\(onPdpStage,"tcp_connected"\)/);
  assert.match(resolver,/emitPdp\(onPdpStage,"tls_ready"\)/);
  assert.match(resolver,/emitPdp\(options\.onPdpStage,"price_selected"\)/);
  assert.match(provider,/const pdpTraces=stageStarted\?/);
  assert.match(provider,/Promise\.allSettled\(resolutionLinks\.map\(async/);
  assert.match(provider,/options\.onPdpSummary\?\.\(summary\)/);
});
