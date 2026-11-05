import {writeFile} from 'node:fs/promises';
const urls=['https://www.newegg.com/p/pl?d=ssd','https://www.newegg.com/logitech-920-010548/p/N82E16823126688'];
const profiles=[
 {name:'standard-html',headers:{'User-Agent':'UEE-ResearchBot/0.4 (public source validation)','Accept':'text/html','Accept-Language':'en-US,en;q=0.9'}},
 {name:'html-with-cache-validation',headers:{'User-Agent':'UEE-ResearchBot/0.4 (public source validation)','Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.8','Cache-Control':'no-cache'}},
 {name:'html-with-saved-data',headers:{'User-Agent':'UEE-ResearchBot/0.4 (public source validation)','Accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5','Accept-Language':'en','Save-Data':'on'}}
];
const output=[];
for(const profile of profiles)for(const url of urls){
 const start=performance.now();
 try{
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:profile.headers});
  const html=await response.text();
  const title=html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||null;
  const blocked=[403,429].includes(response.status)||/just a moment|captcha|access denied/i.test(title||'');
  const result={profile:profile.name,url,httpStatus:response.status,title,bytes:Buffer.byteLength(html),elapsedMs:Math.round(performance.now()-start),blocked,productEvidence:!blocked&&(/application\/ld\+json/.test(html)||/item-cell/.test(html))};
  output.push(result);console.log('UEE_NEWEGG_HEADERS '+JSON.stringify(result));
 }catch(error){const result={profile:profile.name,url,error:String(error),elapsedMs:Math.round(performance.now()-start)};output.push(result);console.log('UEE_NEWEGG_HEADERS '+JSON.stringify(result))}
 await new Promise(resolve=>setTimeout(resolve,900));
}
await writeFile('uee-sandbox/newegg-results.json',JSON.stringify(output,null,2));
