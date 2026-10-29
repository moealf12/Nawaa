// Five offline Python subprocess import samples. Never claims source HTTP P95.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
const PY=fileURLToPath(new URL("../workers/python-intelligence/.venv/bin/python",import.meta.url));
assert.ok(existsSync(PY),"MANAGED_PYTHON_312_MISSING");
const code="import sys,httpx,bs4,lxml,pydantic,rapidfuzz,nawaa_py.jarir_pdp; assert sys.version_info[:2]==(3,12);print('READY')";
const samples=[];
for(let i=0;i<5;i++){
  const t=performance.now();
  const r=spawnSync(PY,["-I","-c",code],{
    encoding:"utf8",timeout:3500,maxBuffer:4096,
    env:{PATH:process.env.PATH??"",PYTHONDONTWRITEBYTECODE:"1"}
  });
  const elapsedMs=Math.round(performance.now()-t);
  assert.equal(r.status,0,"PYTHON_IMPORT_FAILED");
  assert.equal(r.stdout.trim(),"READY");
  samples.push(elapsedMs);
}
samples.sort((a,b)=>a-b);
console.log("NAWAA_PYTHON_COLD_START "+JSON.stringify({
  test:"OFFLINE_PYTHON_312_COLD_START",
  count:samples.length,minMs:samples[0],medianMs:samples[2],maxMs:samples.at(-1),
  note:"subprocess+imports; NOT live source HTTP latency or production P95"
}));
assert.ok(samples.at(-1)<3500,"PYTHON_COLD_START_EXCEEDS_BUDGET");
