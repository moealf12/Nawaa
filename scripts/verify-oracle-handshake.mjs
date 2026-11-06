import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const SHA40=/^[0-9a-f]{40}$/;
const SHA64=/^[0-9a-f]{64}$/;
const ID=/^[A-Z0-9-]{8,80}$/;
const RULES=new Map([
  ["INTENT_REGISTERED",new Set(["START"])],
  ["BASELINE_ATTESTED",new Set(["INTENT_REGISTERED"])],
  ["LIVE_PROBE_RECORDED",new Set(["BASELINE_ATTESTED"])],
  ["LIVE_DIAGNOSTIC_RECORDED",new Set(["LIVE_PROBE_RECORDED"])],
  ["HANDOFF",new Set(["LIVE_PROBE_RECORDED","LIVE_DIAGNOSTIC_RECORDED"])],
]);
const OUTCOMES=new Set([
  "ROBOTS_NOT_CONFIRMED_STOP","ROBOTS_DISALLOWED_STOP","SOURCE_ACCESS_DENIED",
  "SOURCE_REQUEST_FAILED","SEARCH_HTML_OBSERVED_NOT_PRICE_CERTIFIED",
  "SEARCH_ACCESS_UNAVAILABLE",
]);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function eventDigest(event) {
  const {eventHash,...material}=event;
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
export function loadOracleHandshake(){
  const dir=new URL("../engineering/oracle-agent/",import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL("manifest.json",dir),"utf8"));
  const events=readFileSync(new URL("events.jsonl",dir),"utf8")
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  return {manifest,events};
}
export function validateOracleHandshake(manifest,events,{currentMainSha=null,structureOnly=false}={}){
  const errors=[];const fail=(field,msg)=>errors.push(field+": "+msg);
  if(!obj(manifest))return ["manifest: missing"];
  if(manifest.schemaVersion!=="nawaa.oracle-governance.v1")fail("schemaVersion","wrong");
  if(manifest.taskId!=="OCI-NOON-SA-20261106")fail("taskId","unexpected");
  if(manifest.repo!=="moealf12/Nawaa")fail("repo","unexpected");
  if(manifest.branch!=="experiment/oracle-noon-sa-governance-20261106")fail("branch","unexpected");
  if(!SHA40.test(manifest.baseMainSha||""))fail("baseMainSha","invalid");
  for(const k of ["noMainWrites","noMerge","noDeploy","noProductionDataWrites","noPaidResources"])
    if(manifest[k]!==true)fail(k,"must be true");
  if(manifest.autonomousAgentEnabled!==false)fail("autonomousAgentEnabled","must be false");
  if(manifest.scope!=="oracle-only/noon-sa/live-evidence")fail("scope","unexpected");
  const p=manifest.liveProbePolicy;
  if(!obj(p)||p.firstPartyOnly!==true||p.source!=="https://www.noon.com"||
      p.market!=="saudi-en"||p.queryBudget!==1||p.maxHttpRequests!==2||
      p.timeoutSeconds!==12||p.maxResponseBytes!==2000000||p.retries!==0||
      p.proxy!==false||p.accessDenialStop!==true||p.robotsFailClosed!==true||
      p.priceCustomerPublishable!==false)fail("liveProbePolicy","unsafe or changed");
  const allowed=[
    "engineering/oracle-agent/","scripts/verify-oracle-handshake.mjs",
    "scripts/noon-oracle-probe.py","tests/oracle-handshake.test.mjs",
    ".github/workflows/oracle-noon-governance.yml"
  ];
  if(JSON.stringify(manifest.allowedPaths)!==JSON.stringify(allowed))
    fail("allowedPaths","must match isolated scope");
  if(!structureOnly && (!SHA40.test(currentMainSha||"") || currentMainSha!==manifest.baseMainSha))
    fail("mainSHA","fresh external head SHA required and must match frozen baseline");
  if(!Array.isArray(events)||events.length<2||events.length>20)
    return [...errors,"events: expected 2..20 recorded steps"];
  let last="START",previous=null,previousTime=-Infinity;
  const seqSet=new Set();
  for(const [index,event] of events.entries()){
    const at="events["+index+"]";
    if(!obj(event)){fail(at,"not an object");continue;}
    if(event.seq!==index+1 || seqSet.has(event.seq))fail(at+".seq","not monotonic");
    seqSet.add(event.seq);
    if(event.taskId!==manifest.taskId||event.branch!==manifest.branch||
       event.baseMainSha!==manifest.baseMainSha)fail(at,"identity mismatch");
    if(!RULES.get(event.type)?.has(last))fail(at+".type","invalid transition from "+last);
    if(event.prevHash!==previous)fail(at+".prevHash","chain mismatch");
    if(!SHA64.test(event.eventHash||"")||event.eventHash!==eventDigest(event))
      fail(at+".eventHash","invalid digest");
    if(!Number.isFinite(Date.parse(event.observedAt)) ||
       new Date(event.observedAt).toISOString()!==event.observedAt)
      fail(at+".observedAt","invalid ISO timestamp");
    const when=Date.parse(event.observedAt);
    if(when<previousTime)fail(at+".observedAt","time went backward");
    previousTime=when;
    if(!obj(event.details))fail(at+".details","missing");
    if(event.type==="BASELINE_ATTESTED" &&
       (event.details.githubMainSha!==manifest.baseMainSha||
        event.details.oracleGatewayStatus!=="ready"||
        !Array.isArray(event.details.existingPrsReviewed)||
        ![302,303,326].every(n=>event.details.existingPrsReviewed.includes(n))))
      fail(at+".details","baseline provenance missing");
    if(event.type==="LIVE_PROBE_RECORDED" || event.type==="LIVE_DIAGNOSTIC_RECORDED"){
      const d=event.details;
      if(!/^job_[A-Z0-9]{15,50}$/.test(d.gatewayJobId||""))
        fail(at+".details.gatewayJobId","missing durable Gateway job");
      if(d.source!=="noon-sa"||d.query!=="laptop"||
         d.customerPublished!==false||d.proxy!==false||
         !OUTCOMES.has(d.outcome))fail(at+".details","source/provenance invalid");
      if(!Number.isInteger(d.httpRequests)||d.httpRequests<1||d.httpRequests>2)
        fail(at+".details.httpRequests","request budget exceeded");
      if(d.outcome==="ROBOTS_NOT_CONFIRMED_STOP"||
         d.outcome==="ROBOTS_DISALLOWED_STOP"){
        if(d.searchHttp!==null||d.candidateCount!==0)
          fail(at+".details","fail-closed robots must stop before search");
      }
      if(d.outcome==="SEARCH_HTML_OBSERVED_NOT_PRICE_CERTIFIED" &&
          (d.robotsAllowed!==true||d.searchHttp!==200||
           !SHA64.test(d.responseSha256||"")))
        fail(at+".details","search HTML evidence incomplete");
      if(d.pdpVerified!==false||d.checkoutVerified!==false)
        fail(at+".details","unverified parity claim");
    }
    if(event.type==="HANDOFF"){
      const d=event.details;
      if(d.decision!=="NO_GO"||d.sourcePriceCount!==0||
         d.customerPublished!==false||d.mainMerged!==false||
         d.productionDeployed!==false||!Array.isArray(d.diagnosticJobs)||
         !["job_01M6QGDY0V00M8RHCGW1S4D732","job_01M6QGEBPD00398XJB2075K4A4"].every(id=>d.diagnosticJobs.includes(id)))
        fail(at+".details","handoff cannot claim success or omit failed transport evidence");
    }
    previous=event.eventHash;
    last=event.type;
  }
  if(events[0]?.type!=="INTENT_REGISTERED"||
     events[1]?.type!=="BASELINE_ATTESTED")
    fail("events","intent and baseline handshake mandatory");
  return errors;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const structureOnly=process.argv.includes("--structure-only");
  const ix=process.argv.indexOf("--current-main-sha");
  const currentMainSha=ix>=0?process.argv[ix+1]:null;
  try{
    const {manifest,events}=loadOracleHandshake();
    const errors=validateOracleHandshake(manifest,events,{currentMainSha,structureOnly});
    if(errors.length){errors.forEach(x=>console.error("ORACLE_HANDSHAKE_FAIL "+x));process.exitCode=1;}
    else console.log("ORACLE_HANDSHAKE_VALID steps="+events.length+" latest="+events.at(-1).type+
      " release=NO_GO merge=FORBIDDEN production=UNCHANGED");
  }catch(e){console.error("ORACLE_HANDSHAKE_FAIL "+e.message);process.exitCode=1;}
}
