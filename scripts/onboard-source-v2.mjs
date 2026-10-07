import {onboardSource} from "../server/source-inspector/orchestrator.mjs";
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,x)=>{if(v.startsWith("--"))a.push([v.slice(2),x[i+1]]);return a;},[]));
if(!args.url||!args.id)throw new Error("Usage: --id <source> --url <store-url>");
const result=await onboardSource(args.url,{sourceId:args.id});
const summary={sourceId:args.id,url:args.url,stage:result.stage,productionEligible:result.productionEligible,selectedStrategy:result.inspection?.selectedStrategy||null,deepProbe:result.deepProbe||null,capabilities:result.inspection?.capabilities||null,probes:result.inspection?.probes||null,profile:result.profile||null};
process.stdout.write(JSON.stringify(summary,null,2)+"\n");
process.exit(result.stage==="DEEP_PROBE_REQUIRED"?0:result.productionEligible?0:1);
