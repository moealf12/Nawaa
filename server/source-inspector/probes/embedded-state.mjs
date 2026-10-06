function parseJson(raw){try{return JSON.parse(raw)}catch{return null}}
export function probeEmbeddedState(html=""){
 const text=String(html); const candidates=[];
 const patterns=[
  {id:"next-data",re:/<script(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi},
  {id:"application-json",re:/<script(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi},
 ];
 for(const {id,re} of patterns){let m;while((m=re.exec(text))){const data=parseJson(m[1].trim());if(data)candidates.push({id,data});}}
 return {strategy:"embedded-state",ok:candidates.length>0,count:candidates.length,candidates};
}
