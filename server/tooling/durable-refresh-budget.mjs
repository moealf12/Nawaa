import {PILOT_PRODUCTS} from "../../src/ikea-pilot-products.mjs";
// Opt-in, database-atomic, per-merchant request budget for manual refresh work.
// Intentionally NOT invoked by HTTP routes, search or background startup.
const WINDOW_MS=24*60*60*1000;
const MAX_REQUESTS=10;
let pool=null,initPromise=null;
function requireEnabled(){
 if(process.env.NAWAA_ENABLE_REFRESH_BUDGET!=="1"||
    process.env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"||
    !process.env.DATABASE_URL)
  throw new Error("durable_refresh_budget_disabled");
}
async function connection(){
 requireEnabled();
 if(!pool){
  const {default:pg}=await import("pg");
  const ssl=process.env.DATABASE_SSL==="false"?false:
   {rejectUnauthorized:true};
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl,max:2});
 }
 return pool;
}
export async function initDurableRefreshBudget(){
 const db=await connection();
 if(!initPromise){
  initPromise=db.query(
   "CREATE TABLE IF NOT EXISTS nawaa_refresh_request_budgets ("+
   "source_id text PRIMARY KEY,"+
   "window_started_at timestamptz NOT NULL,"+
   "requests_used integer NOT NULL CHECK(requests_used >= 0 AND requests_used <= 10));"+
   "CREATE TABLE IF NOT EXISTS nawaa_refresh_product_attempts ("+
   "source_id text NOT NULL,sku text NOT NULL,"+
   "last_attempted_at timestamptz NOT NULL,"+
   "PRIMARY KEY (source_id,sku))"
  ).catch(error=>{initPromise=null;throw error;});
 }
 await initPromise;
 return {ready:true,limit:MAX_REQUESTS,windowMs:WINDOW_MS};
}
function requireSource(sourceId){
 if(sourceId!=="ikea-sa")throw new Error("refresh_source_not_enabled");
}
function checkedClock(clock){
 const t=clock();
 if(!Number.isSafeInteger(t)||t<0)throw new Error("invalid_refresh_clock");
 return new Date(t);
}
function rowResult(row,now){
 const started=new Date(row.window_started_at).getTime();
 const expired=now-started>=WINDOW_MS;
 const used=expired?0:Number(row.requests_used);
 return {sourceId:row.source_id,windowStartedAt:expired?now:started,
  requestsUsed:used,remainingRequests:MAX_REQUESTS-used,
  resetAt:(expired?now:started)+WINDOW_MS};
}
export async function getDurableRefreshBudget(sourceId,{clock=Date.now}={}){
 requireSource(sourceId);
 const now=checkedClock(clock).getTime();
 const db=await connection();
 await initDurableRefreshBudget();
 const found=await db.query(
  "SELECT source_id,window_started_at,requests_used FROM nawaa_refresh_request_budgets WHERE source_id=$1",
  [sourceId]);
 if(!found.rowCount)return {sourceId,windowStartedAt:now,
   requestsUsed:0,remainingRequests:MAX_REQUESTS,resetAt:now+WINDOW_MS};
 return rowResult(found.rows[0],now);
}
const RESERVATION_SQL=String.raw`
 INSERT INTO nawaa_refresh_request_budgets AS b
   (source_id,window_started_at,requests_used)
 VALUES($1,$2::timestamptz,2)
 ON CONFLICT(source_id) DO UPDATE SET
   window_started_at=CASE WHEN b.window_started_at <= EXCLUDED.window_started_at-INTERVAL '24 hours'
     THEN EXCLUDED.window_started_at ELSE b.window_started_at END,
   requests_used=CASE WHEN b.window_started_at <= EXCLUDED.window_started_at-INTERVAL '24 hours'
     THEN 2 ELSE b.requests_used+2 END
 WHERE b.window_started_at <= EXCLUDED.window_started_at-INTERVAL '24 hours'
   OR b.requests_used+2 <= 10
 RETURNING source_id,window_started_at,requests_used
 `;;
export async function reserveDurableRefreshRequests(sourceId,{clock=Date.now}={}){
 requireSource(sourceId);
 const now=checkedClock(clock);
 const db=await connection();
 await initDurableRefreshBudget();
 // Each IKEA price proof makes two page GETs: JSON-LD + customer-facing HTML.
 // Charge both BEFORE any network I/O, including failures. No refunds.
 // ON CONFLICT locks the source row and serializes simultaneous reservations.
 const result=await db.query(RESERVATION_SQL,[sourceId,now.toISOString()]);
 if(!result.rowCount)return {admitted:false,reason:"daily_request_budget_exhausted",
  ...(await getDurableRefreshBudget(sourceId,{clock:()=>now.getTime()}))};
 return {admitted:true,chargedRequests:2,...rowResult(result.rows[0],now.getTime())};
}
export async function reserveDurableProductRefresh(sourceId,sku,{clock=Date.now}={}){
 requireSource(sourceId);
 if(!PILOT_PRODUCTS.some(item=>item.sku===sku))
  throw new Error("refresh_product_not_approved");
 const now=checkedClock(clock);
 const db=await connection();
 await initDurableRefreshBudget();
 const tx=await db.connect();
 try{
  await tx.query("BEGIN");
  // The product lease and the two-request quota reservation commit together.
  // PostgreSQL ON CONFLICT locks the SKU across parallel workers and processes.
  const lease=await tx.query(String.raw`
   INSERT INTO nawaa_refresh_product_attempts AS a
     (source_id,sku,last_attempted_at)
   VALUES($1,$2,$3::timestamptz)
   ON CONFLICT(source_id,sku) DO UPDATE SET
     last_attempted_at=EXCLUDED.last_attempted_at
   WHERE a.last_attempted_at <= EXCLUDED.last_attempted_at-INTERVAL '6 hours'
   RETURNING sku
  `,[sourceId,sku,now.toISOString()]);
  if(!lease.rowCount){
   await tx.query("ROLLBACK");
   return {admitted:false,reason:"product_refresh_cooldown",chargedRequests:0};
  }
  const quota=await tx.query(RESERVATION_SQL,[sourceId,now.toISOString()]);
  if(!quota.rowCount){
   await tx.query("ROLLBACK");
   return {admitted:false,reason:"daily_request_budget_exhausted",chargedRequests:0};
  }
  await tx.query("COMMIT");
  return {admitted:true,sku,chargedRequests:2,
   ...rowResult(quota.rows[0],now.getTime())};
 }catch(error){
  try{await tx.query("ROLLBACK");}catch{}
  throw error;
 }finally{tx.release();}
}
export async function closeDurableRefreshBudget(){
 if(pool){const current=pool;pool=null;initPromise=null;await current.end();}
}
