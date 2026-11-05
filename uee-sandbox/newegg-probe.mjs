import {writeFile} from 'node:fs/promises';
const targets=['https://www.newegg.com/p/pl?d=ssd','https://www.newegg.com/logitech-920-010548/p/N82E16823126688'];
const profiles=[
 {name:'html-en',headers:{'User-Agent':'UEE-ResearchBot/0.4 (public source validation)','Accept':'text/html','Accept-Language':'en-US,en;q=0.9'}},
 {name:'html-compression',headers:{'User-Agent':'UEE-ResearchBot/0.4 (public source validation)','Accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Accept-Encoding':'gzip, deflate, br'}}
];
const output=[];
for(const profile of profiles)for(const url of targets){
 const started=performance.now();
 try{
  const res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:profile.headers});
  const body=await res.text();
  const title=body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||null;
  const blocked=res.status===403||res.status===429||/just a moment|captcha|access denied|are you a human/i.test(title||'');
  const result={profile:profile.name,url,httpStatus:res.status,bytes:Buffer.byteLength(body),durationMs:Math.round(performance.now()-started),title,blocked,classification:blocked?'SOURCE_ACCESS_BLOCKED':res.status===200?'HTTP_OK':'HTTP_OTHER'};
  console.log('UEE_NEWEGG '+JSON.stringify(result));output.push(result);
 }catch(e){const result={profile:profile.name,url,error:String(e),durationMs:Math.round(performance.now()-started),classification:'NETWORK_ERROR'};console.log('UEE_NEWEGG '+JSON.stringify(result));output.push(result)}
 if(output.at(-1).blocked)await new Promise(resolve=>setTimeout(resolve,750));
}
await writeFile('uee-sandbox/newegg-results.json',JSON.stringify(output,null,2));
