// NAWAA source transport: fetch-first, explicit per-merchant opt-in only.
// Never change outbound IP/network after a denial, and never infer inventory.
import {chooseSourceTransport} from "../src/source-request-routing.mjs";
import {merchantRequestHeaders} from "../src/source-http-profile.mjs";

const normalizeIds=(ids)=>Array.isArray(ids) ? ids.filter(x=>typeof x==="string" && /^[a-z0-9][a-z0-9-]{1,79}$/i.test(x)) : [];
const unsafeHost=(host)=>!host || host==="localhost" || host.endsWith(".localhost") ||
  host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") ||
  host==="0.0.0.0" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
function safeUrl(raw){
  let url;
  try{url=new URL(String(raw));}catch{throw Error("HTTPS_REQUIRED");}
  if(url.protocol!=="https:" || (url.port && url.port!=="443"))throw Error("HTTPS_REQUIRED");
  if(url.username||url.password)throw Error("CREDENTIALS_FORBIDDEN");
  if(unsafeHost(url.hostname.toLowerCase()))throw Error("PUBLIC_DNS_REQUIRED");
  return url;
}
const allowedHosts=(list)=>new Set((Array.isArray(list)?list:[])
  .filter(x=>typeof x==="string"&&x.length<254).map(x=>x.trim().toLowerCase()).filter(Boolean));

// Standalone protocol-compatible HTTP client. No browser TLS/JA3 profile,
// no proxy, no TLS validation disable, and no retry/fallback after a 403.
// This remains optional and OFF until installed and intentionally enabled.
// Do not use it as a PDP replacement without equivalent DNS/IP pinning.
let impitSessionPromise;
async function optionalImpitFetch(url,init){
  if(!impitSessionPromise){
    impitSessionPromise=import("impit").then(({Impit})=>{
      const client=new Impit({
        followRedirects:false,
        vanillaFallback:false,
        ignoreTlsErrors:false,
        timeout:8000,
      });
      return (input,options)=>client.fetch(input,options);
    }).catch(error=>{
      impitSessionPromise=null;
      throw Object.assign(new Error("IMPIT_OPTIONAL_DEPENDENCY_UNAVAILABLE"),{cause:error});
    });
  }
  return (await impitSessionPromise)(url,init);
}

export function createApprovedSourceFetcher({
  fetchImpl=globalThis.fetch,
  impitFetch=optionalImpitFetch,
  approvedSourceIds=[],
  approvedSourceHosts={},
  optIn=false,
}={}){
  const approved=normalizeIds(approvedSourceIds);
  return async function fetchSource(url,init={},context={}){
    const parsed=safeUrl(url);
    const method=String(init?.method||"GET").toUpperCase();
    if(method!=="GET")throw Error("GET_ONLY");
    const sourceId=String(context?.sourceId||"");
    const transport=chooseSourceTransport({sourceId,approvedSourceIds:approved,optIn});
    const hosts=allowedHosts(approvedSourceHosts[sourceId]);
    if(transport==="impit"){
      // A strict public-host allowlist and no redirects are mandatory.
      // This is host allowlisting, NOT DNS/IP pinning. PDP uses the
      // existing pinned transport until equivalent socket pinning exists.
      if(!hosts.has(parsed.hostname.toLowerCase()))throw Error("HOST_NOT_ALLOWED");
      // Only the BIKE24 isolated PDP JSON-LD experiment may request a
      // structured representation. Negotiation does not guarantee JSON or
      // imply access permission. Never forward spoofed caller UA headers.
      const requestedAccept=init.headers?.accept || init.headers?.Accept;
      const structuredAccept="application/ld+json, application/json, text/html";
      const headers=sourceId==="bike24-de"
        ? {...merchantRequestHeaders(sourceId),
           ...(context?.structuredPdp===true && requestedAccept===structuredAccept
               ? {accept:structuredAccept} : {})}
        : init.headers;
      return impitFetch(parsed.href,{...init,headers,method:"GET",redirect:"error"});
    }
    if(hosts.size&&!hosts.has(parsed.hostname.toLowerCase()))throw Error("HOST_NOT_ALLOWED");
    return fetchImpl(parsed.href,{...init,method:"GET"});
  };
}

// A cold-start-safe zero-cost default. Per-merchant opt-in must be explicit.
// Merely enabling a source does not prove that it permits indexing.
const fromEnv=()=>String(process.env.NAWAA_IMPIT_SOURCE_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);
export function createRuntimeSourceFetcher({
  fetchImpl=globalThis.fetch,
  impitFetch=optionalImpitFetch,
}={}){
  // No hosts are inferred from user-controlled URLs.
  const knownHosts={
    "amazon-uk":["www.amazon.co.uk"],
    "amazon-de":["www.amazon.de"],
    "mediamarkt-de":["www.mediamarkt.de"],
    "pccomponentes-es":["www.pccomponentes.com"],
    "bike24-de":["www.bike24.com"],
    "thomann-de":["www.thomann.de"],
  };
  const approved=fromEnv().filter(id=>Object.hasOwn(knownHosts,id));
  return createApprovedSourceFetcher({
    fetchImpl,impitFetch,approvedSourceIds:approved,approvedSourceHosts:knownHosts,optIn:approved.length>0,
  });
}
