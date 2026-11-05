// Strict no-paid-plan gate for the SerpApi Google Shopping experiment.
// Calls SerpApi's documented free-of-charge Account API and never returns
// credentials/account identifiers. Fail closed on missing/ambiguous evidence.
const ACCOUNT_URL = "https://serpapi.com/account.json";
const MAX_ACCOUNT_BYTES = 16_384;
const ACCOUNT_TIMEOUT_MS = 4500;
const FREE_SEARCHES_MONTHLY = 250;
const FREE_THROUGHPUT_HOURLY = 50;
const MONTHLY_RESERVE = 50; // leave a hard buffer for distributed concurrency
const HOURLY_RESERVE = 10;

export function certifySerpApiZeroPaidAccount(account) {
  if(!account||typeof account!=="object"||Array.isArray(account))
    return {allowed:false,reason:"ACCOUNT_RESPONSE_INVALID"};
  // A false-positive is more costly than a false-negative. Require affirmative
  // zero-price, Free plan ID/name, exact free monthly and hourly entitlements.
  const name=String(account.plan_name||"").trim();
  const id=String(account.plan_id||"").trim();
  if(!(/^(?:free|free plan)$/i.test(name)||/^free$/i.test(id)) ||
     account.plan_monthly_price!==0)
    return {allowed:false,reason:"NOT_VERIFIED_ZERO_DOLLAR_FREE_PLAN"};
  if(account.searches_per_month!==FREE_SEARCHES_MONTHLY ||
     account.account_rate_limit_per_hour!==FREE_THROUGHPUT_HOURLY)
    return {allowed:false,reason:"FREE_PLAN_LIMITS_NOT_ATTESTED"};
  const remaining=account.plan_searches_left;
  const hourlyUsed=account.this_hour_searches;
  if(!Number.isInteger(remaining)||!Number.isInteger(hourlyUsed)||
     remaining<0||hourlyUsed<0)
    return {allowed:false,reason:"ACCOUNT_QUOTA_EVIDENCE_MISSING"};
  if(remaining<=MONTHLY_RESERVE)
    return {allowed:false,reason:"ZERO_COST_MONTHLY_RESERVE_REACHED"};
  if(hourlyUsed>=FREE_THROUGHPUT_HOURLY-HOURLY_RESERVE)
    return {allowed:false,reason:"ZERO_COST_HOURLY_RESERVE_REACHED"};
  return {allowed:true,reason:"FREE_ACCOUNT_WITH_RESERVED_QUOTA"};
}

async function readBoundedJson(response) {
  const length=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(length)&&length>MAX_ACCOUNT_BYTES)throw Error("ACCOUNT_BODY_TOO_LARGE");
  if(!response.body)throw Error("ACCOUNT_BODY_MISSING");
  let n=0;const chunks=[];
  for await(const part of response.body) {
    n+=part.byteLength;
    if(n>MAX_ACCOUNT_BYTES){
      await response.body.cancel?.().catch(()=>{});
      throw Error("ACCOUNT_BODY_TOO_LARGE");
    }
    chunks.push(Buffer.from(part));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function checkSerpApiFreeAccount({apiKey,fetchImpl=globalThis.fetch}={}){
  if(typeof apiKey!=="string"||apiKey.length<12)
    return {allowed:false,reason:"ACCOUNT_KEY_NOT_CONFIGURED"};
  try {
    const u=new URL(ACCOUNT_URL);
    u.searchParams.set("api_key",apiKey);
    const response=await fetchImpl(u.href,{
      method:"GET",
      headers:{accept:"application/json"},
      redirect:"error",
      signal:AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
    });
    if(response.status!==200 ||
       !String(response.headers.get("content-type")||"").toLowerCase().includes("json"))
      return {allowed:false,reason:"ACCOUNT_VERIFICATION_UNAVAILABLE"};
    return certifySerpApiZeroPaidAccount(await readBoundedJson(response));
  }catch{
    return {allowed:false,reason:"ACCOUNT_VERIFICATION_UNAVAILABLE"};
  }
}
