// IKEA Saudi refresh admission planner. Pure, read-only, not a crawler or scheduler.
// A caller-supplied usage snapshot is not a durable quota ledger: do not use
// this planning result alone to authorize production network requests.
export const IKEA_REFRESH_POLICY=Object.freeze({
 sourceId:"ikea-sa",maxProductsPerRun:5,requestsPerProduct:2,
 maxRequestsPerWindow:10,windowMs:24*60*60*1000,
 revisitMs:6*60*60*1000,staleMs:48*60*60*1000,
 backoffBaseMs:30*60*1000,backoffCapMs:24*60*60*1000,
 maxConsecutiveFailures:3
});
const safeTime=(input)=> {
 if(typeof input==="number")return Number.isSafeInteger(input)&&input>=0?input:null;
 if(typeof input==="string"&&input.trim()){
  const value=Date.parse(input);return Number.isSafeInteger(value)&&value>=0?value:null;
 }
 return null;
};
function checkedProduct(input){
 if(!input||typeof input!=="object"||typeof input.sku!=="string"||
    !/^\d{8}$/.test(input.sku))throw new Error("invalid_refresh_product");
 let url;
 try{url=new URL(input.url);}catch{throw new Error("invalid_refresh_product_url");}
 if(url.protocol!=="https:"||url.username||url.password||url.port||
   url.search||url.hash||!["ikea.com","www.ikea.com"].includes(url.hostname.toLowerCase())||
   !/^\/sa\/(?:en|ar)\/p\/[a-z0-9-]+\/?$/i.test(url.pathname))
  throw new Error("unapproved_refresh_product_url");
 const slug=url.pathname.split("/").filter(Boolean).at(-1);
 const match=/(?:^|-)(?:s)?(\d{8})$/i.exec(slug);
 if(!match||match[1]!==input.sku)throw new Error("refresh_product_sku_mismatch");
 return {url:url.href,sku:input.sku};
}
function stateTime(state,key,now,{allowFuture=false}={}){
 const input=state?.[key];
 if(input===undefined||input===null)return null;
 const t=safeTime(input);
 if(t===null||(!allowFuture&&t>now+30000))throw new Error("invalid_refresh_state_time");
 return t;
}
export function priceFreshnessStatus(observedAt,{now=Date.now(),revisitMs=IKEA_REFRESH_POLICY.revisitMs,staleMs=IKEA_REFRESH_POLICY.staleMs}={}){
 if(!Number.isSafeInteger(now)||now<0)throw new Error("invalid_refresh_clock");
 if(observedAt===undefined||observedAt===null)
  return {status:"unknown",ageMs:null,refreshDue:true,displayTrust:"unverified"};
 const at=safeTime(observedAt);
 if(at===null||at>now+30000)
  return {status:"invalid",ageMs:null,refreshDue:false,displayTrust:"unverified"};
 const age=Math.max(0,now-at);
 return {status:age>=staleMs?"stale":age>=revisitMs?"aging":"fresh",
  ageMs:age,refreshDue:age>=revisitMs,
  displayTrust:age>=staleMs?"stale":"observed"};
}
function checkedBudget(budget,now,policy){
 if(!budget||typeof budget!=="object")throw new Error("refresh_budget_snapshot_required");
 const start=safeTime(budget.windowStartedAt);
 const used=budget.requestsUsed;
 if(start===null||start>now+30000||!Number.isInteger(used)||used<0)
  throw new Error("invalid_refresh_budget_snapshot");
 const expired=now-start>=policy.windowMs;
 const consumed=expired?0:used;
 if(consumed>policy.maxRequestsPerWindow)throw new Error("refresh_budget_exceeded");
 return {windowStartedAt:expired?now:start,requestsUsed:consumed,
  remainingRequests:policy.maxRequestsPerWindow-consumed,
  resetAt:(expired?now:start)+policy.windowMs};
}
function blockReason(state,now,policy){
 if(!state||typeof state!=="object")return null;
 const failures=state.consecutiveFailures??0;
 if(!Number.isInteger(failures)||failures<0||failures>1000)
  throw new Error("invalid_refresh_failures");
 const status=state.lastHttpStatus??null;
 if(status!==null&&(!Number.isInteger(status)||status<100||status>599))
  throw new Error("invalid_refresh_http_status");
 if([400,401,403,404,410,451].includes(status))return "manual_review_http_status";
 if(failures>=policy.maxConsecutiveFailures)return "manual_review_failure_limit";
 const lastAttempt=stateTime(state,"lastAttemptAt",now);
 const retryAfter=stateTime(state,"retryAfterUntil",now,{allowFuture:true});
 if(retryAfter!==null&&now<retryAfter)return "merchant_retry_after_cooldown";
 if(failures>0&&lastAttempt!==null){
  const backoff=Math.min(policy.backoffCapMs,
   policy.backoffBaseMs*2**Math.min(failures-1,12));
  if(now<lastAttempt+backoff)return "failure_backoff";
 }
 return null;
}
export function planIkeaRefresh({products,observations={},budget,now=Date.now(),
 policy=IKEA_REFRESH_POLICY}={}){
 if(!Number.isSafeInteger(now)||now<0)throw new Error("invalid_refresh_clock");
 if(!Array.isArray(products)||products.length>25)throw new Error("invalid_refresh_catalog");
 const seen=new Set();
 const catalog=products.map(item=>{
  const checked=checkedProduct(item);
  if(seen.has(checked.sku)||seen.has(checked.url))throw new Error("duplicate_refresh_product");
  seen.add(checked.sku);seen.add(checked.url);
  const state=observations[checked.sku]??{};
  const lastSuccess=stateTime(state,"lastSuccessfulAt",now);
  const freshness=priceFreshnessStatus(lastSuccess,{now,revisitMs:policy.revisitMs,staleMs:policy.staleMs});
  const blocked=blockReason(state,now,policy);
  return {...checked,freshness,lastSuccessfulAt:lastSuccess,
   reason:blocked||(freshness.refreshDue?null:"not_due_yet")};
 });
 const quota=checkedBudget(budget,now,policy);
 // The most stale products receive priority; unknown products are next.
 const due=catalog.filter(x=>!x.reason).sort((a,b)=>{
  const aAge=a.freshness.ageMs??Number.POSITIVE_INFINITY;
  const bAge=b.freshness.ageMs??Number.POSITIVE_INFINITY;
  return bAge-aAge||a.sku.localeCompare(b.sku);
 });
 const selected=due.slice(0,Math.min(policy.maxProductsPerRun,
  Math.floor(quota.remainingRequests/policy.requestsPerProduct)));
 const admitted=new Set(selected.map(x=>x.sku));
 const entries=catalog.map(x=>({
  sku:x.sku,url:x.url,freshness:x.freshness,
  decision:admitted.has(x.sku)?"planned":"skipped",
  reason:admitted.has(x.sku)?null:
   x.reason||(quota.remainingRequests<policy.requestsPerProduct?
     "request_budget_exhausted":"run_capacity_or_budget")
 }));
 return {mode:"read_only_refresh_admission_plan",sourceId:policy.sourceId,
  generatedAt:new Date(now).toISOString(),schedulingEnabled:false,
  productionEnforcementReady:false,estimatedRequests:selected.length*policy.requestsPerProduct,
  quota:{...quota,remainingAfterPlan:quota.remainingRequests-selected.length*policy.requestsPerProduct},
  planned:selected.map(x=>({sku:x.sku,url:x.url,ageMs:x.freshness.ageMs})),
  entries};
}
