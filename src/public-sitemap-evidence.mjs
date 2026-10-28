// Fail-closed public sitemap parser. A sitemap URL is discovery metadata,
// not evidence of stock, sellable price, quantity or merchant authorization.
const MAX_SITEMAP_BYTES=2_000_000;
const MAX_ENTRIES=10_000;
const decodeXml=(s)=>String(s).replace(/&amp;/g,"&").replace(/&lt;/g,"<")
  .replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const safeHost=(host)=>Boolean(host) && host!=="localhost" &&
  !host.endsWith(".local") && !host.endsWith(".internal") &&
  !host.includes(":") && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
export function parsePublicSitemapXml(xml,{merchantHost,maxEntries=MAX_ENTRIES}={}){
  const body=String(xml||"");
  const limit=Math.min(MAX_ENTRIES,Math.max(1,Math.floor(Number(maxEntries)||0)));
  const host=String(merchantHost||"").toLowerCase();
  if(!safeHost(host)||body.length>MAX_SITEMAP_BYTES ||
    /<!DOCTYPE\b|<!ENTITY\b/i.test(body))
    return {complete:false,urls:[],reason:"INVALID_OR_UNTRUSTED_SITEMAP"};
  // Sitemap indexes are NOT complete catalogs. Resolve all child sitemaps
  // separately with their own verified observation before computing any diff.
  if(/<(?:\w+:)?sitemapindex\b/i.test(body))
    return {complete:false,urls:[],reason:"SITEMAP_INDEX_REQUIRES_CHILDREN"};
  if(!/<(?:\w+:)?urlset(?:\s|>)/i.test(body))
    return {complete:false,urls:[],reason:"NOT_A_URL_SITEMAP"};
  const urls=[],seen=new Set();
  const re=/<(?:\w+:)?url(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?url\s*>/gi;
  let m,count=0;
  while((m=re.exec(body))){
    count++;
    if(count>limit)return {complete:false,urls:[],reason:"SITEMAP_LIMIT_EXCEEDED"};
    const value=m[1].match(/<(?:\w+:)?loc\s*>([\s\S]*?)<\/(?:\w+:)?loc\s*>/i)?.[1];
    if(!value)continue;
    try{
      const url=new URL(decodeXml(value.trim()));
      if(url.protocol!=="https:" || url.username || url.password ||
        url.port && url.port!=="443" || url.hostname.toLowerCase()!==host)continue;
      url.hash="";
      if(!seen.has(url.href)){seen.add(url.href);urls.push(url.href);}
    }catch{}
  }
  return {complete:true,urls,reason:"SITEMAP_URLSET_PARSED"};
}
