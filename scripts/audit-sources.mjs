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
const output = JSON.stringify(audit, null, 2);
await writeFile(outputPath, output);
console.log(output);
