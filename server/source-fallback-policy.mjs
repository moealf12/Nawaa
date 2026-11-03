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
