// Optional NAWAA Reader strategy. Never called by the customer search path.
// Authenticated Jina requests may consume token credits: enforce a strict local ceiling.
import {isIP} from "node:net";
const HOUR_MS=60*60*1000;

export function publicReaderUrl(raw) {
  if(typeof raw!=="string" || raw.length>2000) return null;
  let url;
  try {url=new URL(raw);} catch {return null;}
  if(url.protocol!=="https:" || url.username || url.password || url.port) return null;
  const host=url.hostname.toLowerCase();
  if(!host.includes(".") || isIP(host) || host==="localhost" ||
     host.endsWith(".localhost") || host.endsWith(".local") ||
     host.endsWith(".internal") || host.endsWith(".test") ||
     host.endsWith(".invalid") || host.endsWith(".example")) return null;
  url.hash="";
  return url.href;
}

/**
 * Strict opt-in, backend-only Jina Reader adapter used for source discovery.
 * Markdown is untrusted content; never treat it as a certified product price.
 * Do not expose this adapter as an unrestricted HTTP URL-reading endpoint.
 */
export function createJinaReader({
  enabled=process.env.NAWAA_ENABLE_JINA_READER==="1",
  apiKey=process.env.JINA_API_KEY || "",
  hourlyLimit=10,
  timeoutMs=15000,
  maxCharacters=80000,
  cacheTtlMs=10*60*1000,
  clock=()=>Date.now(),
  fetcher=globalThis.fetch,
}={}) {
  const budget=Math.max(1,Math.min(60,Math.trunc(Number(hourlyLimit)||10)));
  const timeout=Math.max(1000,Math.min(30000,Number(timeoutMs)||15000));
  const cap=Math.max(1000,Math.min(200000,Math.trunc(Number(maxCharacters)||80000)));
  const cache=new Map();
  const pending=new Map();
  let attempts=[];

  async function read(rawUrl) {
    const target=publicReaderUrl(rawUrl);
    if(!target) return {ok:false,status:"invalid_public_url"};
    if(!enabled) return {ok:false,status:"disabled"};
    if(typeof apiKey!=="string" || !apiKey.trim()) return {ok:false,status:"not_configured"};

    const cached=cache.get(target);
    if(cached && cached.expiresAt>clock()) return {...cached.value,cached:true};
    if(pending.has(target)) return pending.get(target);
    const now=clock();
    attempts=attempts.filter(stamp=>stamp>now-HOUR_MS);
    if(attempts.length>=budget) return {ok:false,status:"hourly_budget_exhausted"};
    attempts.push(now);

    const work=(async()=>{
      try {
        const response=await fetcher("https://r.jina.ai/"+target,{
          method:"GET",
          headers:{Authorization:"Bearer "+apiKey,Accept:"text/plain","X-Respond-With":"markdown"},
          redirect:"error",
          signal:AbortSignal.timeout(timeout),
        });
        if(response.status===401 || response.status===403) return {ok:false,status:"authorization_failed"};
        if(response.status===402) return {ok:false,status:"credits_exhausted"};
        if(response.status===429) return {ok:false,status:"rate_limited"};
        if(!response.ok) return {ok:false,status:"upstream_error"};
        const markdown=String(await response.text());
        if(!markdown.trim()) return {ok:false,status:"empty_content"};
        const result={
          ok:true,status:"ok",pageUrl:target,
          markdown:markdown.slice(0,cap),
          truncated:markdown.length>cap,
          fetchedAt:new Date(clock()).toISOString(),
          cached:false,
        };
        cache.set(target,{value:result,expiresAt:clock()+cacheTtlMs});
        if(cache.size>100) cache.delete(cache.keys().next().value);
        return result;
      }catch(error) {
        return {ok:false,status:error?.name==="AbortError"||error?.name==="TimeoutError"?"timeout":"network_error"};
      }finally {
        pending.delete(target);
      }
    })();
    pending.set(target,work);
    return work;
  }
  return {read};
}
