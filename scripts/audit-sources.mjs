import { writeFile } from "node:fs/promises";
import { auditFreeStorefronts } from "../server/source-audit.mjs";

const args=process.argv.slice(2);
let outputPath="source-audit-results.json",storeId=null,query=null;
for(let i=0;i<args.length;i++){
  if(args[i]==="--store"){storeId=args[++i] || null;continue;}
  if(args[i]==="--query"){query=args[++i] || null;continue;}
  if(!args[i].startsWith("--") && outputPath==="source-audit-results.json") outputPath=args[i];
}
const audit = await auditFreeStorefronts({storeId,query});
const NEGATIVE_QUERY="nawaa-unfindable-943271-20261003";
const rows=Array.isArray(audit?.results)?audit.results:[];
const failures=[];
for(const row of rows){
  if(query===NEGATIVE_QUERY && Number(row?.verifiedOffers||0)!==0) failures.push(`${row.storeId}: negative control returned ${row.verifiedOffers} offers`);
  if(query && query!==NEGATIVE_QUERY && (row?.status==="ERROR" || Number(row?.verifiedOffers||0)===0)) failures.push(`${row.storeId}: positive query produced no usable offers (${row?.error||row?.status||"unknown"})`);
}
const output = JSON.stringify({...audit,acceptance:{passed:failures.length===0,failures}}, null, 2);
await writeFile(outputPath, output);
console.log(output);
if(failures.length) process.exitCode=1;

// Phase III audit trigger: PR validates the live-source acceptance matrix.
