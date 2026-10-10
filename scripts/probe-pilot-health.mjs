// No database, no network and no notification integrations.
import {PILOT_PRODUCTS} from "../src/ikea-pilot-products.mjs";
import {assessPilotHealth} from "../server/tooling/pilot-health-monitor.mjs";
const now=Date.parse("2026-10-10T12:00:00Z");
const obs=(price,h)=>({price,currency:"SAR",observedAt:new Date(now-h*3600000).toISOString(),healthStatus:"healthy"});
const histories={
 [PILOT_PRODUCTS[0].sku]:{configured:true,observations:[obs(479,1),obs(600,27)]},
 [PILOT_PRODUCTS[1].sku]:{configured:true,observations:[obs(299,8)]},
 [PILOT_PRODUCTS[2].sku]:{configured:true,observations:[obs(149,49)]},
 [PILOT_PRODUCTS[3].sku]:{configured:true,observations:[]}
};
const report=assessPilotHealth({histories,now});
if(report.totalProducts!==5||report.significantMoves!==1||
 report.counters.stale!==1||report.counters.aging!==1||
 report.productionAlertsSent!==0)throw new Error("offline_health_proof_failed");
console.log(JSON.stringify({passed:true,...report},null,2));
