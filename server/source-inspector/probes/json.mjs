function addCandidate(out,raw,baseUrl){try{const value=String(raw||"").trim();if(!value||/[{}]/.test(value))return;const u=new URL(value,baseUrl);if(/^https?:$/.test(u.protocol))out.add(u.toString())}catch{}}
export function discoverJsonCandidates(html="",baseUrl){
 const text=String(html),out=new Set();
 const patterns=[
  /(?:fetch\(|axios\.(?:get|post)\(|url\s*[:=])\s*["'`]([^"'`]+)["'`]/gi,
  /<(?:form|a)\b[^>]*(?:action|href)=["']([^"']*(?:search|query|catalog|product)[^"']*)["']/gi,
  /["'](?:searchUrl|searchEndpoint|apiUrl|endpoint|productUrl)["']\s*:\s*["']([^"']+)["']/gi
 ];
 for(const re of patterns){let m;while((m=re.exec(text)))addCandidate(out,m[1],baseUrl)}
 return [...out];
}
export function classifyEndpoint(url=""){
 const s=String(url).toLowerCase();
 if(/graphql/.test(s))return "graphql";
 if(/(?:search|query|text=|q=)/.test(s))return "search";
 if(/(?:product|catalog|sku|\/p\/)/.test(s))return "product";
 return "json-xhr";
}
export function probeJsonCandidates(html="",baseUrl){
 const candidates=discoverJsonCandidates(html,baseUrl).map(url=>({url,type:classifyEndpoint(url)}));
 return {strategy:"json-xhr",ok:candidates.length>0,count:candidates.length,candidates};
}
