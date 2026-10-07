function absolute(raw,baseUrl){try{return new URL(raw,baseUrl).toString()}catch{return null}}
const PARAM=/(?:[?&](?:page|offset|start|cursor|currentPage|pageSize|size)=)/i;
function modelOf(raw){return /cursor=/i.test(raw)?"cursor":/offset=|start=/i.test(raw)?"offset":/pageSize=|size=/i.test(raw)?"page-size":"page"}
export function discoverPagination(html="",baseUrl){
 const text=String(html),candidates=[],seen=new Set();
 const add=(raw,model,evidence)=>{const url=absolute(raw,baseUrl);if(!url||seen.has(url))return;seen.add(url);candidates.push({url,model,evidence})};
 let m;
 const tags=/<(?:a|link)\b[^>]*>/gi;
 while((m=tags.exec(text))){const tag=m[0],href=tag.match(/href=["']([^"']+)["']/i)?.[1];if(!href)continue;const next=/rel=["'][^"']*next[^"']*["']/i.test(tag)||/aria-label=["'][^"']*(?:next|التالي)[^"']*["']/i.test(tag);if(next)add(href,"next-link","html-next");else if(PARAM.test(href))add(href,modelOf(href),"html-parameter")}
 const quoted=/(?:["'])([^"']*(?:[?&](?:page|offset|start|cursor|currentPage|pageSize|size)=)[^"']+)(?:["'])/gi;
 while((m=quoted.exec(text)))add(m[1],modelOf(m[1]),"embedded-parameter");
 const metadata={};
 const total=text.match(/(?:1\s*-\s*\d+\s+of\s+|of\s+)([\d,]+)\s+products/i)?.[1]||text.match(/([\d,]+)\s+products/i)?.[1];
 const pageSize=text.match(/item\s*per\s*page\s*(\d+)/i)?.[1];
 if(total)metadata.reportedTotal=Number(total.replace(/,/g,""));
 if(pageSize)metadata.pageSize=Number(pageSize);
 return {ok:candidates.length>0,count:candidates.length,candidates,model:candidates[0]?.model??null,metadata};
}
