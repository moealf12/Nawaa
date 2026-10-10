// Zero-network, zero-database dry-run of five approved pilot URLs.
import {PILOT_PRODUCTS} from "./probe-ikea-batch.mjs";
import {planIkeaRefresh,IKEA_REFRESH_POLICY} from "../server/tooling/source-refresh-policy.mjs";
if(process.env.DATABASE_URL||process.env.NAWAA_ENABLE_BACKGROUND_JOBS==="1"||
   process.env.NAWAA_ENABLE_CERTIFIED_INGESTION==="1")
 throw new Error("offline_refresh_plan_only");
const now=Date.now();
const observations=Object.fromEntries(PILOT_PRODUCTS.map((p,i)=>[p.sku,
 i===0?{lastSuccessfulAt:now-60*60*1000}:
 i===1?{lastSuccessfulAt:now-50*60*60*1000}:
 i===2?{consecutiveFailures:1,lastAttemptAt:now-10*60*1000}:
 i===3?{lastHttpStatus:429,retryAfterUntil:now+30*60*1000}:{}]));
const result=planIkeaRefresh({products:PILOT_PRODUCTS,observations,
 budget:{windowStartedAt:now-60*60*1000,requestsUsed:4},now});
if(result.planned.length!==2||result.estimatedRequests!==4||
 result.productionEnforcementReady!==false||result.schedulingEnabled!==false)
 throw new Error("refresh_planning_dry_run_failed");
console.log(JSON.stringify({result,...{merchantRequestsActuallySent:0,dbWrites:0}},null,2));
