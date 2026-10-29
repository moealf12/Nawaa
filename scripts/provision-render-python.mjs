// Invoked by npm postinstall. Only the approved Render Node service can opt in.
// A provisioning failure rejects the candidate build; the previous LIVE stays.
import {execFileSync} from "node:child_process";
const TARGET="srv-dau4olo93c1s73cnj9a0";
if(process.env.RENDER!=="true" ||
   process.env.RENDER_SERVICE_ID!==TARGET ||
   process.env.NAWAA_PYTHON_PREPARE!=="1"){
  if(process.env.RENDER==="true")
    console.log("NAWAA_PYTHON_PROVISION_SKIP flag_off_or_unapproved_service");
}else{
  try{
    execFileSync("bash",["scripts/provision-render-python.sh"],{
      stdio:"inherit",timeout:240_000,env:{...process.env}
    });
  }catch{
    console.error("NAWAA_PYTHON_PROVISION_FAILED");
    process.exitCode=1;
  }
}
