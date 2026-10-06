export function discoverJsonCandidates(html="",baseUrl){
 const out=new Set(); const re=/(?:fetch\(|axios\.(?:get|post)\(|url\s*[:=])\s*["'`]([^"'`]+)["'`]/gi; let m;
 while((m=re.exec(String(html)))){try{const u=new URL(m[1],baseUrl);if(u.protocol.startsWith("http"))out.add(u.toString())}catch{}}
 return [...out];
}
export function classifyEndpoint(url=""){
 const s=String(url).toLowerCase();
 if(/graphql/.test(s))return "graphql"; if(/search|query/.test(s))return "search"; if(/product|catalog|sku/.test(s))return "product"; return "json-xhr";
}
export function probeJsonCandidates(html="",baseUrl){
 const candidates=discoverJsonCandidates(html,baseUrl).map(url=>({url,type:classifyEndpoint(url)}));
 return {strategy:"json-xhr",ok:candidates.length>0,count:candidates.length,candidates};
}
