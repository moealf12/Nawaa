import {writeFile} from 'node:fs/promises';
const targets=[
'https://www.newegg.com/p/pl?d=ssd',
'https://www.newegg.com/logitech-920-010548/p/N82E16823126688'
];
const output=[];
for(const url of targets){
 const started=performance.now();
 try{
  const res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'UEE-ResearchBot/0.4 (public source validation)','Accept':'text/html'}});
  const body=await res.text();
  const title=body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||null;
  const hasProductJsonLd=/<script[^>]*type=["']application\/ld\+json["']/i.test(body);
  const blocked=res.status===403||res.status===429||/captcha|access denied|are you a human/i.test(title||'');
  const result={url,httpStatus:res.status,bytes:Buffer.byteLength(body),durationMs:Math.round(performance.now()-started),title,hasProductJsonLd,blocked,classification:blocked?'SOURCE_ACCESS_BLOCKED':res.status===200?'HTTP_OK':'HTTP_OTHER'};
  console.log('UEE_NEWEGG '+JSON.stringify(result));output.push(result);
 }catch(e){const result={url,error:String(e),durationMs:Math.round(performance.now()-started),classification:'NETWORK_ERROR'};console.log('UEE_NEWEGG '+JSON.stringify(result));output.push(result)}
}
await writeFile('uee-sandbox/newegg-results.json',JSON.stringify(output,null,2));
