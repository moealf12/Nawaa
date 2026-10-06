function absolute(raw,baseUrl){try{return new URL(raw,baseUrl).toString()}catch{return null}}
export function discoverPagination(html="",baseUrl){
 const text=String(html),candidates=[],seen=new Set();
 const add=(raw,model,evidence)=>{const url=absolute(raw,baseUrl);if(!url||seen.has(url))return;seen.add(url);candidates.push({url,model,evidence})};
 let m;
 const link=/<(?:a|link)\b[^>]*(?:href)=["']([^"']+)["'][^>]*(?:rel=["']next["']|aria-label=["'][^"']*(?:next|التالي)[^"']*["'])[^>]*>|<(?:a|link)\b[^>]*(?:rel=["']next["']|aria-label=["'][^"']*(?:next|التالي)[^"']*["'])[^>]*href=["']([^"']+)["'][^>]*>/gi;
 while((m=link.exec(text)))add(m[1]||m[2],"next-link","html-next");
 const urls=text.match(/(?:https?:\/\/[^"'\s<>]+|\/[A-Za-z0-9_./?=&%-]+)(?:[?&](?:page|offset|start|cursor|currentPage)=)[^"'\s<>]*/gi)||[];
 for(const raw of urls){const model=/cursor=/i.test(raw)?"cursor":/offset=|start=/i.test(raw)?"offset":"page";add(raw,model,"parameter")}
 return {ok:candidates.length>0,count:candidates.length,candidates,model:candidates[0]?.model??null};
}
