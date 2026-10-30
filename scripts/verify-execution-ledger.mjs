import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const EXPECTED_PACKAGES = Object.freeze([
  ...Array.from({length:18},(_,i)=>"E"+String(i).padStart(2,"0")),
  ...Array.from({length:17},(_,i)=>"S"+String(i).padStart(2,"0"))
]);
const SHA=/^[0-9a-f]{40}$/;
const STATUSES=new Set(["PLANNED","IN_PROGRESS","BLOCKED","VERIFIED"]);
const PR=/^https:\/\/github\.com\/moealf12\/Nawaa\/pull\/[1-9]\d*$/;
const CI=/^https:\/\/github\.com\/moealf12\/Nawaa\/actions\/runs\/[1-9]\d*$/;
export function validateExecutionLedger(plan){
  const errors=[];
  const fail=(where,why)=>errors.push(where+": "+why);
  if(!plan||typeof plan!=="object"||Array.isArray(plan))return ["plan: expected object"];
  if(plan.schemaVersion!=="nawaa.execution.v1")fail("schemaVersion","unsupported");
  if(plan.planVersion!=="23.20")fail("planVersion","wrong version");
  if(!SHA.test(plan.initialMainSha||""))fail("initialMainSha","invalid SHA");
  if(!Array.isArray(plan.rounds)||plan.rounds.length!==21)return [...errors,"rounds: expected exactly 21"];
  let active=0;
  const seen=new Map();
  for(let i=0;i<21;i++){
    const id="R"+String(i+1).padStart(2,"0");
    const r=plan.rounds[i];
    if(!r||typeof r!=="object"){fail(id,"missing round");continue;}
    if(r.id!==id)fail(id,"round ID/order mismatch");
    if(typeof r.title!=="string"||r.title.trim().length<6)fail(id+".title","missing");
    if(!Array.isArray(r.packages))fail(id+".packages","not an array");
    else {
      if(i===20&&r.packages.length!==0)fail(id+".packages","final certification must not own package");
      if(i<20&&r.packages.length===0)fail(id+".packages","empty implementation assignment");
      for(const p of r.packages){
        if(!EXPECTED_PACKAGES.includes(p))fail(id+".packages","unknown "+String(p));
        if(seen.has(p))fail(id+".packages","duplicate "+p+" from "+seen.get(p));
        seen.set(p,id);
      }
    }
    const dep=i?["R"+String(i).padStart(2,"0")]:[];
    if(JSON.stringify(r.dependsOn)!==JSON.stringify(dep))fail(id+".dependsOn","previous round dependency mismatch");
    if(!STATUSES.has(r.status))fail(id+".status","invalid");
    if(r.status==="IN_PROGRESS")active++;
    if(r.status==="PLANNED"){
      if(r.baseSha!==null)fail(id+".baseSha","planned rounds must not claim baseline");
    }else{
      if(!SHA.test(r.baseSha||""))fail(id+".baseSha","missing exact baseline");
      if(i&&plan.rounds[i-1]?.status!=="VERIFIED")fail(id+".dependsOn","previous round not VERIFIED");
    }
    if(!Array.isArray(r.blockers))fail(id+".blockers","not an array");
    else if(r.status==="BLOCKED"&&!r.blockers.some(x=>typeof x==="string"&&x.trim()))fail(id+".blockers","missing documented blocker");
    if(!r.evidence||typeof r.evidence!=="object"||Array.isArray(r.evidence))fail(id+".evidence","invalid");
    if(r.status==="VERIFIED"){
      const e=r.evidence||{};
      if(!PR.test(e.prUrl||""))fail(id+".evidence.prUrl","PR evidence missing");
      if(!CI.test(e.ciUrl||""))fail(id+".evidence.ciUrl","CI evidence missing");
      if(!CI.test(e.regressionUrl||""))fail(id+".evidence.regressionUrl","regression evidence missing");
      for(const k of ["testedSha","mergedSha","liveSha"]){
        if(!SHA.test(e[k]||""))fail(id+".evidence."+k,"missing valid SHA");
      }
      if(e.liveSha!==e.mergedSha)fail(id+".evidence","live/merged SHA mismatch");
      if(typeof e.deploymentId!=="string"||!/^dep-[a-z0-9]+$/.test(e.deploymentId))fail(id+".evidence.deploymentId","missing");
      if(e.customerAcceptance!=="PASS")fail(id+".evidence.customerAcceptance","not PASS");
      if(e.negativeControl!=="PASS")fail(id+".evidence.negativeControl","not PASS");
      // Syntactic fields do not authenticate external evidence.
    }
  }
  if(active>1)fail("rounds","multiple IN_PROGRESS");
  for(const p of EXPECTED_PACKAGES)if(!seen.has(p))fail("packages","unassigned "+p);
  return errors;
}
export const loadExecutionLedger=()=>JSON.parse(readFileSync(new URL("../engineering/execution/rounds.json",import.meta.url),"utf8"));
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let errors=null;
  try{errors=validateExecutionLedger(loadExecutionLedger());}
  catch(e){console.error("EXECUTION_LEDGER_INVALID "+String(e));process.exitCode=1;}
  if(errors){
    if(errors.length){for(const e of errors)console.error("EXECUTION_LEDGER_INVALID "+e);process.exitCode=1;}
    else console.log("EXECUTION_LEDGER_VALID rounds=21 packages=35");
  }
}
