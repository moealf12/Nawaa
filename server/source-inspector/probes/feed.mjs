export function discoverFeedCandidates(baseUrl,html=""){
 const base=new URL(baseUrl);const out=new Set();
 for(const m of String(html).matchAll(/<link[^>]+(?:type=["'](?:application\/(?:rss\+xml|atom\+xml)|text\/xml)["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+type=["'](?:application\/(?:rss\+xml|atom\+xml)|text\/xml)["'])/gi)){try{out.add(new URL(m[1]||m[2],base).toString())}catch{}}
 return [...out];
}
export function probeFeedHints(baseUrl,html=""){const candidates=discoverFeedCandidates(baseUrl,html);return {strategy:"feed",ok:candidates.length>0,count:candidates.length,candidates};}
