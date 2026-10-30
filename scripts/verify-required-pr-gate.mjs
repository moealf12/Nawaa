import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
export const REQUIRED_PR_JOBS=Object.freeze(["nawaa-pr-core","nawaa-pr-integrations"]);
export function assessRequiredPrReadiness({event,baseRef,sha,checkoutSha,needs}){
  if(event!=="pull_request"||baseRef!=="main")return {allowed:false,reason:"not-main-pr"};
  if(!/^[a-f0-9]{40}$/.test(sha??"")||sha!==checkoutSha)return {allowed:false,reason:"wrong-head"};
  if(!needs||typeof needs!=="object"||Array.isArray(needs))
    return {allowed:false,reason:"missing-needs"};
  const blocked=REQUIRED_PR_JOBS.filter(k=>needs[k]?.result!=="success");
  if(blocked.length)return {allowed:false,reason:"required-jobs-not-successful",blocked};
  return {allowed:true,sha};
}
function main(){
  const checkoutSha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const decision=assessRequiredPrReadiness({
    event:process.env.GITHUB_EVENT_NAME,baseRef:process.env.GITHUB_BASE_REF,
    sha:process.env.NAWAA_EXPECTED_SHA,checkoutSha,
    needs:JSON.parse(process.env.NAWAA_PR_NEEDS_JSON??"null")
  });
  if(!decision.allowed){console.error("PR_MERGE_BLOCKED",JSON.stringify(decision));process.exitCode=1;}
  else console.log("PR_INTEGRATION_GATE_PASS",decision.sha);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{main()}catch(e){console.error("PR_MERGE_BLOCKED",e.message);process.exitCode=1;}
}
