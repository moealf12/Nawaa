// Offline reader for artifacts created by the existing 39-source CI runner.
// Only reads bounded local files; never performs merchant requests.
import {readdir,readFile,stat} from "node:fs/promises";
import {resolve,join} from "node:path";
const MAX_ARTIFACT_BYTES=1024*1024;
const NAME=/^active-source-([a-z0-9-]+)\.json$/;
const LIMIT=256;
export async function loadSourceCertificationArtifacts(directory,activeIds){
 if(!Array.isArray(activeIds)||new Set(activeIds).size!==activeIds.length||
    activeIds.some(id=>typeof id!=="string"||!/^[a-z0-9-]+$/.test(id)))
  throw new Error("invalid_expected_active_sources");
 const expected=new Set(activeIds),dir=resolve(directory);
 const files=(await readdir(dir).catch(error=>{
  if(error?.code==="ENOENT")return [];
  throw error;
 })).sort();
 const reports=new Map(),issues=[];
 if(files.length>LIMIT)throw new Error("too_many_certification_artifacts");
 for(const file of files){
  const match=NAME.exec(file);
  if(!match)continue;
  const id=match[1];
  if(!expected.has(id)){
   issues.push({sourceId:id,code:"unexpected_source_artifact"});
   continue;
  }
  try{
   const size=(await stat(join(dir,file))).size;
   if(size<2||size>MAX_ARTIFACT_BYTES)throw new Error("artifact_size_invalid");
   const payload=JSON.parse(await readFile(join(dir,file),"utf8"));
   if(payload?.source!==id)throw new Error("artifact_source_identity_mismatch");
   if(typeof payload.passed!=="boolean"||!Array.isArray(payload.cases)||
      !Array.isArray(payload.routeCoverage))
    throw new Error("artifact_evidence_schema_invalid");
   if(typeof payload.observedAt!=="string"||
      !Number.isFinite(Date.parse(payload.observedAt)))
    throw new Error("artifact_observation_timestamp_invalid");
   // Truncated/incorrectly named artifacts must never certify a source.
   reports.set(id,payload);
  }catch(error){
   issues.push({sourceId:id,code:[
    "artifact_size_invalid","artifact_source_identity_mismatch",
    "artifact_evidence_schema_invalid","artifact_observation_timestamp_invalid"
   ].includes(error?.message)?error.message:"artifact_unreadable_or_corrupt"});
  }
 }
 return {reports,issues,reportCount:reports.size,expectedCount:activeIds.length};
}
