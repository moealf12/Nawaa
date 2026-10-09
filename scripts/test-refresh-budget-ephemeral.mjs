// Disposable DB only; tests atomic request admission without any merchant calls.
import assert from "node:assert/strict";
import pg from "pg";
import {initDurableRefreshBudget,getDurableRefreshBudget,
 reserveDurableRefreshRequests,closeDurableRefreshBudget} from "../server/tooling/durable-refresh-budget.mjs";
const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1"||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"")||
 env.DATABASE_SSL!=="false"||env.NAWAA_ENABLE_REFRESH_BUDGET!=="1"||
 env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1")
 throw new Error("refusing_non_ephemeral_budget_test");
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
try{
 await initDurableRefreshBudget();
 await assert.rejects(reserveDurableRefreshRequests("unknown-source"),/refresh_source_not_enabled/);
 const requests=await Promise.all(Array.from({length:7},()=>reserveDurableRefreshRequests("ikea-sa")));
 const approved=requests.filter(x=>x.admitted);
 assert.equal(approved.length,5);
 assert.equal(requests.filter(x=>!x.admitted).length,2);
 const current=await getDurableRefreshBudget("ikea-sa");
 assert.equal(current.requestsUsed,10);
 assert.equal(current.remainingRequests,0);
 const rows=await pool.query("select source_id,requests_used from nawaa_refresh_request_budgets");
 assert.equal(rows.rowCount,1);
 assert.equal(rows.rows[0].requests_used,10);
 // Fixed daily window rolls forward, then permits only one two-request booking.
 await pool.query("update nawaa_refresh_request_budgets set window_started_at=now()-interval '25 hours'");
 const renewed=await reserveDurableRefreshRequests("ikea-sa");
 assert.equal(renewed.admitted,true);
 assert.equal(renewed.requestsUsed,2);
 assert.equal(renewed.remainingRequests,8);
 const post=await pool.query("select requests_used from nawaa_refresh_request_budgets");
 assert.equal(post.rows[0].requests_used,2);
 console.log(JSON.stringify({passed:true,mode:"durable_merchant_request_budget",
  concurrentReservationAttempts:7,admitted:5,denied:2,
  requestCapPer24h:10,chargedOnAdmission:10,
  secondWindowResetVerified:true,remainingAfterResetBooking:8,
  merchantNetworkRequests:0,productionWrites:false},null,2));
}finally{await closeDurableRefreshBudget();await pool.end();}
