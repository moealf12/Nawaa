export function discoverSitemapCandidates(baseUrl,html=""){
 const base=new URL(baseUrl); const out=new Set([new URL("/sitemap.xml",base).toString()]);
 for(const m of String(html).matchAll(/href=["']([^"']*sitemap[^"']*)["']/gi)){try{out.add(new URL(m[1],base).toString())}catch{}}
 return [...out];
}
export async function probeSitemap(baseUrl,{fetchImpl=fetch,timeoutMs=5000}={}){
 const candidates=discoverSitemapCandidates(baseUrl); const attempts=[];
 for(const url of candidates.slice(0,3)){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetchImpl(url,{signal:controller.signal,headers:{accept:"application/xml,text/xml,*/*"}});const text=await r.text();attempts.push({url,status:r.status,ok:r.ok,isSitemap:/<(?:urlset|sitemapindex)[\s>]/i.test(text),bytes:text.length});}catch(e){attempts.push({url,ok:false,error:e?.name||"fetch-error"});}finally{clearTimeout(timer)}}
 return {strategy:"sitemap",ok:attempts.some(x=>x.ok&&x.isSitemap),attempts};
}
