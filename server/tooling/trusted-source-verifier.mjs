// Defense-in-depth host identity check. A matching domain is NOT evidence of a
// live price observation: a second trusted, independent evidence verifier is required.
function normalizeHost(host){
 const h=String(host||"").trim().toLowerCase().replace(/\.$/,"").replace(/^www\./,"");
 if(!h||h==="localhost"||h.endsWith(".local")||h.includes(":")||/^\d+(?:\.\d+){3}$/.test(h)||!h.includes("."))throw new Error("invalid_trusted_merchant_host");
 return h;
}
export function createTrustedSourceVerifier({sourceHosts={},verifyEvidence}={}){
 if(typeof verifyEvidence!=="function")throw new Error("evidence_verifier_required");
 const registry=new Map();
 for(const [sourceId,hosts] of Object.entries(sourceHosts)){
  if(!/^[a-z0-9][a-z0-9-]{1,79}$/.test(sourceId)||!Array.isArray(hosts)||!hosts.length)throw new Error("invalid_source_registry");
  registry.set(sourceId,new Set(hosts.map(normalizeHost)));
 }
 return async ({sourceId,offer,job})=>{
  const allowed=registry.get(sourceId);
  if(!allowed||!offer||typeof offer!=="object")return false;
  let url;try{url=new URL(offer.sourceUrl);}catch{return false;}
  if(url.protocol!=="https:"||url.username||url.password||url.port)return false;
  let host;try{host=normalizeHost(url.hostname);}catch{return false;}
  if(!allowed.has(host))return false;
  // Evidence should be sourced and checked independently, not read as an
  // authorization flag or unverifiable assertion from the queued payload.
  return await verifyEvidence({sourceId,offer,job})===true;
 };
}
