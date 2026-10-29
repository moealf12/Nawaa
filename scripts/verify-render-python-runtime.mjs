// Read-only startup evidence, not a public health endpoint. Never blocks Node.
import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
const PYTHON=fileURLToPath(new URL("../workers/python-intelligence/.venv/bin/python",import.meta.url));
export function inspectPythonRuntime(){
  if(!existsSync(PYTHON))return {ready:false,reason:"RUNTIME_EXECUTABLE_ABSENT"};
  const probe="import json,sys,httpx,bs4,lxml,pydantic,rapidfuzz,nawaa_py.jarir_pdp; assert sys.version_info[:2]==(3,12);print(json.dumps({\"python\":\"3.12\",\"jarir\":True}))";
  const start=performance.now();
  const out=spawnSync(PYTHON,["-I","-c",probe],{
    encoding:"utf8",timeout:20000,maxBuffer:4096,
    env:{PATH:process.env.PATH??"",PYTHONUNBUFFERED:"1",PYTHONDONTWRITEBYTECODE:"1"}
  });
  const elapsedMs=Math.round(performance.now()-start);
  if(out.error||out.status!==0)return {
    ready:false,
    reason:out.error?.code==="ETIMEDOUT"?"PYTHON_COLD_START_TIMEOUT":
      "PYTHON_IMPORT_OR_RUNTIME_FAILURE",
    elapsedMs,
    // No stacktrace, stderr or filesystem paths leave the server.
    failureClass:out.error?.code==="ETIMEDOUT"?"COLD_START_TIMEOUT":
      out.signal?"CHILD_SIGNAL":"NONZERO_EXIT"
  };
  try{
    const data=JSON.parse(out.stdout.trim());
    if(data.python!=="3.12"||data.jarir!==true)throw Error("IMPORT_INVALID");
    return {ready:true,version:data.python,elapsedMs,source:"deployed-managed-venv"};
  }catch{return {ready:false,reason:"PYTHON_RUNTIME_OUTPUT_INVALID",elapsedMs};}
}
if(process.env.RENDER==="true" &&
  process.env.RENDER_SERVICE_ID==="srv-dau4olo93c1s73cnj9a0"){
  console.log("NAWAA_RENDER_PYTHON_RUNTIME "+JSON.stringify(inspectPythonRuntime()));
}
