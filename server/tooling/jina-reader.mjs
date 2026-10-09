// Optional Jina Reader adapter for background source discovery only.
// Never exposes API credentials to users or trusts Markdown as a verified offer.
const MAX_MARKDOWN_BYTES=512*1024;
const MAX_RESPONSE_MS=15000;
function publicHostname(hostname) {
  const h=String(hostname||"").toLowerCase().replace(/\.$/,"");
  if(!h||h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal"))return false;
  if(/^\d+\.\d+\.\d+\.\d+$/.test(h))return false;
  if(h.startsWith("[")||h.includes(":"))return false;
  return h.includes(".");
}
export function validateJinaTarget(target,{allowedHosts=[]}={}) {
  let u;try{u=new URL(String(target));}catch{throw new Error("jina_target_invalid");}
  if(u.protocol!=="https:"||u.username||u.password||u.port||!publicHostname(u.hostname))throw new Error("jina_target_not_allowed");
  if(!Array.isArray(allowedHosts)||!allowedHosts.length)throw new Error("jina_allowlist_required");
  const host=u.hostname.toLowerCase();
  if(!allowedHosts.some(item=>{
    const allowed=String(item).toLowerCase().replace(/^www\./,"").replace(/\.$/,"");
    return allowed&&host.replace(/^www\./,"")===allowed;
  }))throw new Error("jina_target_not_allowed");
  u.hash="";
  return u.toString();
}
export async function readJinaPage(target,{allowedHosts=[],fetchImpl=globalThis.fetch,env=process.env,timeoutMs=MAX_RESPONSE_MS,signal}={}) {
  if(!env.JINA_API_KEY)throw new Error("jina_not_configured");
  const safeUrl=validateJinaTarget(target,{allowedHosts});
  const deadline=Math.max(1000,Math.min(MAX_RESPONSE_MS,Number(timeoutMs)||MAX_RESPONSE_MS));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),deadline);
  const abort=()=>controller.abort();
  signal?.addEventListener("abort",abort,{once:true});
  try {
    // Reader URL is composed server-side from a strictly allowlisted HTTPS target.
    const apiUrl="https://r.jina.ai/"+safeUrl;
    const response=await fetchImpl(apiUrl,{
      method:"GET",redirect:"error",signal:controller.signal,
      headers:{"authorization":`Bearer ${env.JINA_API_KEY}`,"accept":"text/plain","x-return-format":"markdown"},
    });
    if(response.status===429)return {ok:false,status:"rate_limited",retryAfter:response.headers?.get("retry-after")||null};
    if(!response.ok)return {ok:false,status:"upstream_error",httpStatus:response.status};
    const claimed=Number(response.headers?.get("content-length"));
    if(Number.isFinite(claimed)&&claimed>MAX_MARKDOWN_BYTES)return {ok:false,status:"too_large"};
    const markdown=await response.text();
    if(Buffer.byteLength(markdown,"utf8")>MAX_MARKDOWN_BYTES)return {ok:false,status:"too_large"};
    return {ok:true,sourceUrl:safeUrl,markdown};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort",abort);
  }
}
