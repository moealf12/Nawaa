const urls=['https://www.newegg.com/robots.txt','https://www.newegg.com/sitemap.xml'];
for(const url of urls){
 const started=performance.now();
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'manual',headers:{'User-Agent':'UEE-ResearchBot/0.4 (public source validation)','Accept':'text/plain,application/xml;q=0.9,*/*;q=0.5'}});
  const body=await r.text();
  const sample=body.slice(0,300).replace(/\s+/g,' ');
  const result={url,status:r.status,contentType:r.headers.get('content-type'),bytes:Buffer.byteLength(body),durationMs:Math.round(performance.now()-started),sample};
  console.log('UEE_NEWEGG_DISCOVERY '+JSON.stringify(result));
 }catch(e){console.log('UEE_NEWEGG_DISCOVERY '+JSON.stringify({url,error:String(e)}))}
}
