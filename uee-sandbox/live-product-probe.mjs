import { createHash } from 'node:crypto';
const targets = [
  'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
  'https://books.toscrape.com/catalogue/tipping-the-velvet_999/index.html',
  'https://www.python.org/'
];
function parseProduct(html,url) {
  const title=html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim()??null;
  const price=html.match(/<p[^>]*class=["'][^"']*price_color[^"']*["'][^>]*>\s*[^\d]*(\d+(?:\.\d{2})?)/i)?.[1]??null;
  const image=html.match(/<div[^>]*class=["'][^"']*item active[^"']*["'][^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)/i)?.[1]??null;
  return {name:title,price,currency:price?'GBP':null,image:image?new URL(image,url).href:null,provenance:'dom:books_toscrape'};
}
async function main() {
  let failures=0;
  for(const url of targets){
    const start=performance.now();
    try {
      const robotsUrl=new URL('/robots.txt',url);
      const robots=await fetch(robotsUrl,{signal:AbortSignal.timeout(12000),redirect:'manual'});
      if(![200,404,410].includes(robots.status))throw Error('ROBOTS_UNAVAILABLE_'+robots.status);
      const bodyRobots=robots.status===200?await robots.text():'';
      if(bodyRobots.split(/\r?\n/).some(line=>/^disallow:\s*\/catalogue\//i.test(line)))throw Error('ROBOTS_DISALLOW');
      const res=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'manual',headers:{'User-Agent':'UEE-ResearchBot/0.4 (independent live validation)'}});
      const html=await res.text();
      if(html.length>2000000)throw Error('SIZE_LIMIT');
      const product=parseProduct(html,url);
      const isProduct=url.includes('/catalogue/');
      const valid=!isProduct||(product.name&&product.price&&product.image);
      const record={url,status:res.status,bytes:Buffer.byteLength(html),durationMs:Math.round(performance.now()-start),contentHash:createHash('sha256').update(html).digest('hex').slice(0,16),product,valid:Boolean(valid)};
      console.log('UEE_LIVE_RESULT '+JSON.stringify(record));
      if(res.status!==200||!valid)failures++;
    }catch(e){failures++;console.log('UEE_LIVE_ERROR '+JSON.stringify({url,error:String(e),durationMs:Math.round(performance.now()-start)}));}
  }
  if(failures)process.exitCode=1;
}
await main();
