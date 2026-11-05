import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const targets=['https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html','https://books.toscrape.com/catalogue/tipping-the-velvet_999/index.html'];
const results=[];
await mkdir('uee-sandbox/polyglot/pages',{recursive:true});
for(let i=0;i<targets.length;i++){
 const url=targets[i],start=performance.now();
 try {
  const robots=await fetch(new URL('/robots.txt',url),{signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(![200,404,410].includes(robots.status))throw Error('ROBOTS_UNKNOWN_'+robots.status);
  if(robots.status===200){const txt=await robots.text();if(/(?:^|\n)\s*Disallow:\s*\/catalogue\//i.test(txt))throw Error('ROBOTS_DISALLOW');}
  const r=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'manual',headers:{'User-Agent':'UEE-ResearchBot/0.4'}});
  if(r.status!==200)throw Error('HTTP_'+r.status);
  const data=Buffer.from(await r.arrayBuffer());
  if(data.length>2000000)throw Error('SIZE_LIMIT');
  await writeFile('uee-sandbox/polyglot/pages/'+i+'.html',data);
  results.push({url,status:r.status,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),durationMs:Math.round(performance.now()-start)});
 }catch(e){results.push({url,error:String(e)});}
}
await writeFile('uee-sandbox/polyglot/results.json',JSON.stringify({acquisition:results},null,2));
if(results.some(x=>x.error))process.exitCode=1;
