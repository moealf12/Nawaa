// One request's observed, source-owned access denial is sufficient evidence
// not to replay that *same storefront* immediately for a fallback query.
// This is not a global cooldown and never excludes unknown/empty/timeout
// merchants, other providers, Amazon's independent route, or future requests.
const NON_RETRYABLE_IN_REQUEST=new Set([
  "HTTP_403_ACCESS_DENIED","HTTP_429_RATE_LIMITED",
  "SOURCE_ACCESS_DENIED_COOLDOWN","SOURCE_RATE_LIMIT_COOLDOWN",
]);

export function retryDeniedStorefrontIds(errors,{registeredIds}={}){
  const known=registeredIds instanceof Set ? registeredIds :
    new Set(Array.isArray(registeredIds)?registeredIds:[]);
  const excluded=new Set();
  for(const issue of Array.isArray(errors)?errors:[]){
    const id=issue?.market;
    if(typeof id!=="string" || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(id) ||
       !known.has(id))continue;
    // Require a source-owned storefront error. Do not let a failure from
    // another provider suppress a store with a coincidentally similar name.
    if(issue.sourceId!==id && issue.sourceId!=="free-storefronts")continue;
    if(NON_RETRYABLE_IN_REQUEST.has(issue.failureClass))excluded.add(id);
  }
  return [...excluded].sort();
}

/**
 * A real shopper-level deadline or an intentionally shortened fallback
 * discovery pass cannot certify that all eligible providers settled.
 * Strict cache admission requires a provably known zero, never a guessed one.
 */
export function providersPendingAfterFallback(errors,{deadlineExceeded=false}={}){
  if(deadlineExceeded)return null;
  if((Array.isArray(errors)?errors:[]).some(x=>
    x?.pass==="fallback"&&x?.error==="fallback_budget_limited"))return null;
  return 0;
}


// Both of these merchant/store IDs have an independent first-wave acquisition
// task in providerTasks. Sending the identical query through the generic
// storefront pass duplicates public HTTP work, inflates failure observations,
// and increases source pressure on Render's free compute. In particular,
// the "virgin-ae" direct task already calls searchFreeStorefrontById with a
// *larger* PDP budget than its generic storefront route.
//
// Keep every other live merchant eligible and preserve source-scoped
// non-retryable fallback observations. The generic store router backfills
// excluded slots with the next ranked merchant; the full cursor still
// retains unrelated stores.
const DEDICATED_FIRST_WAVE_STOREFRONTS=Object.freeze(["amazon-sa","virgin-ae"]);
export function genericStorefrontPassExclusions(deniedIds=[],{registeredIds}={}){
  const known=registeredIds instanceof Set?registeredIds:
    new Set(Array.isArray(registeredIds)?registeredIds:[]);
  const excluded=new Set(DEDICATED_FIRST_WAVE_STOREFRONTS);
  for(const id of Array.isArray(deniedIds)?deniedIds:[]){
    if(typeof id==="string"&&known.has(id))excluded.add(id);
  }
  return [...excluded];
}
