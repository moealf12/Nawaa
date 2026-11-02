// Independent browser DOM parity contract. Only compare one UI and one SAME
// intercepted SSE session; never compare separately timed JSON/SSE acquisitions.
// A fallback/recovery JSON request changes the evidence lineage and fails closed.
export function compareR04DomOrder({expectedKeys,domKeys,recoveryRequests=0,streamDone=false}={}){
  const failures=[];
  if(!streamDone)failures.push("SSE_NOT_DONE");
  if(!Array.isArray(expectedKeys)||!expectedKeys.length)failures.push("NO_EXPECTED_GROUPS");
  if(!Array.isArray(domKeys)||!domKeys.length)failures.push("NO_DOM_GROUPS");
  if(!Number.isSafeInteger(recoveryRequests)||recoveryRequests<0)
    failures.push("RECOVERY_COUNTER_INVALID");
  else if(recoveryRequests>0)failures.push("RECOVERY_NOT_SAME_SNAPSHOT");
  if(Array.isArray(expectedKeys)&&Array.isArray(domKeys)){
    if(expectedKeys.length!==domKeys.length)failures.push("DOM_GROUP_COUNT_MISMATCH");
    if(expectedKeys.some((x,i)=>!x||typeof x!=="string"||domKeys[i]!==x))
      failures.push("DOM_GROUP_ORDER_MISMATCH");
    if(new Set(domKeys).size!==domKeys.length)failures.push("DUPLICATE_DOM_GROUP");
  }
  return {pass:failures.length===0,failures:[...new Set(failures)],
    expectedCount:Array.isArray(expectedKeys)?expectedKeys.length:null,
    observedCount:Array.isArray(domKeys)?domKeys.length:null};
}
