// v21.8 isolated first-ten real Chromium acceptance for six previously untested queries.
// Test-only: no payment, quotes, production persistence or deployment.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import net from 'node:net';

const queries=[
  'iPhone 17 256GB Black','iPhone 17 512GB','iPhone 17 Pro','Dior',
  'PS5 disc drive','nawaa-unfindable-943271-20261003'
];
const negative=queries.at(-1);
const out={environment:'isolated_pr_head',queries:[],errors:[],generatedAt:new Date().toISOString(),
  requiredNewQueries:queries.length,realChromium:true,result:'INCOMPLETE'};
mkdirSync('browser-artifacts',{recursive:true});
const env={...process.env,NODE_ENV:'test',DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:'',
  NOON_ENABLED:'false',CARREFOUR_ENABLED:'false',EBAY_ENABLED:'false',
  SEARCH_STREAM_DEADLINE_MS:'10000',SEARCH_REQUEST_DEADLINE_MS:'12000'};
let server,browser;
try{
  const port=await new Promise((resolve,reject)=>{
    const s=net.createServer();s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
  });
  server=spawn(process.execPath,['server/server.mjs'],{env:{...env,PORT:String(port)},stdio:'ignore'});
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<140;i++){
    if(server.exitCode!==null)throw Error('candidate process exited: '+server.exitCode);
    try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(800)});if(r.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw Error('candidate not healthy');
  const bin=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);
  if(!bin)throw Error('real Chromium binary missing');
  browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const query of queries){
    const result={query,status:'INCOMPLETE',assertions:{},errors:[],firstTen:[],firstUsefulResultMs:null};
    out.queries.push(result);
    let context;
    try{
      context=await browser.newContext({viewport:{width:1365,height:850},locale:'ar-SA',timezoneId:'Asia/Riyadh',serviceWorkers:'block'});
      await context.addInitScript(()=>{
        const Native=window.EventSource;
        window.__nawaaMatrix={done:false,snapshots:0,anyExact:false,exactSamples:[],lastOfferCount:0};
        if(!Native)return;
        window.EventSource=class extends Native {
          constructor(...args){
            super(...args);
            this.addEventListener('snapshot',event=>{
              try{
                const offers=JSON.parse(event.data)?.offers||[];
                const r=window.__nawaaMatrix;r.snapshots++;r.lastOfferCount=offers.length;
                for(const o of offers){
                  if(o.exactMatch===true){
                    r.anyExact=true;
                    if(r.exactSamples.length<6)r.exactSamples.push({
                      title:String(o.title||'').slice(0,140),merchant:String(o.merchant||'').slice(0,60)
                    });
                  }
                }
              }catch{}
            });
            this.addEventListener('done',()=>{window.__nawaaMatrix.done=true;});
          }
        };
      });
      const page=await context.newPage();
      const runtimeErrors=[];
      page.on('pageerror',error=>runtimeErrors.push(String(error.message).slice(0,180)));
      const start=performance.now();
      const nav=await page.goto(base+'/search.html?q='+encodeURIComponent(query),
        {waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>{
        const results=document.querySelector('#results');
        const status=document.querySelector('#searchStatus')?.textContent||'';
        return Boolean(results?.querySelector('.match-result-card,.no-match,.live-search-error'))||
          /تعذر الاتصال|حدث خطأ|غير متاح|فشل الاتصال/.test(status);
      },null,{timeout:55000});
      result.firstUsefulResultMs=Math.round(performance.now()-start);
      await page.waitForFunction(()=>window.__nawaaMatrix?.done,null,{timeout:22000}).catch(()=>{});
      const data=await page.evaluate(()=>{
        const root=document.querySelector('#results');
        const groups=[...root?.querySelectorAll('.match-result-card')||[]].slice(0,10);
        const cards=groups.map((g,index)=>{
          const title=g.querySelector('.match-card-copy strong')?.textContent?.trim()||'';
          g.click();
          const panel=document.querySelector('#results .selected-comparison[open]');
          const merchants=[...panel?.querySelectorAll('.merchant-row .merchant-main strong')||[]]
            .map(n=>n.textContent?.trim()).filter(Boolean);
          const links=[...panel?.querySelectorAll('.product-detail-btn[data-source]')||[]]
            .map(n=>{try{const u=new URL(n.getAttribute('data-source')||'');return u.protocol==='https:'?u.origin+u.pathname:null;}catch{return null;}});
          return {index,title,merchantRows:panel?.querySelectorAll('.merchant-row').length||0,
            merchantNames:[...new Set(merchants)],productLinks:links.filter(Boolean)};
        });
        return {cards,visibleCount:root?.querySelectorAll('.match-result-card').length||0,
          noMatch:Boolean(root?.querySelector('.no-match')),
          liveError:Boolean(root?.querySelector('.live-search-error')),
          status:(document.querySelector('#searchStatus')?.textContent||'').slice(0,190),
          stream:window.__nawaaMatrix||null};
      });
      result.firstTen=data.cards;
      result.visibleCount=data.visibleCount;
      result.noMatch=data.noMatch;
      result.liveError=data.liveError;
      result.statusText=data.status;
      result.stream=data.stream;
      result.runtimeErrors=runtimeErrors;
      result.assertions.navigation=nav?.ok()===true;
      result.assertions.streamFinished=data.stream?.done===true;
      result.assertions.noRuntimeErrors=runtimeErrors.length===0;
      result.assertions.noTransportError=!data.liveError;
      result.assertions.comparisonLinks=data.cards.every(c=>c.title&&c.merchantRows>0&&c.productLinks.length===c.merchantRows);
      if(query===negative){
        result.assertions.noFabricatedExact=data.stream?.anyExact===false;
        result.assertions.cleanNegative=data.noMatch||data.visibleCount>0;
      } else {
        result.assertions.resolvedProductSearch=data.visibleCount>0||
          (data.noMatch&&data.stream?.done===true);
      }
      if(query==='iPhone 17 Pro'){
        // Verify the displayed first ten, not merely the successful loading
        // of an unrelated accessory. Recorded Amazon title sold a Portuguese
        // "Capa" (phone cover), not an iPhone 17 Pro handset.
        result.assertions.noPortugueseCoverAsHandset=!data.cards.some(card=>
          /^\s*capas?\b/i.test(card.title)&&/\biphone\s+17\s+pro\b/i.test(card.title));
      }
      if(query==='PS5 disc drive'){
        result.assertions.explicitAccessoryNotCertifiedConsole=!data.stream?.exactSamples?.some(s=>
          /\bconsole\b/i.test(s.title)&&!/\b(?:drive|cover|accessory)\b/i.test(s.title));
      }
      await page.setViewportSize({width:390,height:844});
      const mobile=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
      result.mobile=mobile;
      result.assertions.noMobileHorizontalOverflow=mobile.scrollWidth<=mobile.viewport+4;
      result.status=Object.values(result.assertions).every(Boolean)?'PASS':'FAIL';
    }catch(e){result.errors.push(String(e?.message||e).slice(0,240));result.status='FAIL';}
    finally{if(context)await context.close().catch(()=>{});}
  }
  out.result=out.queries.length===queries.length&&out.queries.every(x=>x.status==='PASS')?'PASS':'FAIL';
}catch(e){out.errors.push(String(e?.message||e).slice(0,240));out.result='FAIL';}
finally{
  writeFileSync('browser-artifacts/v21.8-customer-matrix.json',JSON.stringify(out,null,2));
  console.log('NAWAA_V218_CUSTOMER_MATRIX '+JSON.stringify(out));
  if(browser)await browser.close().catch(()=>{});
  if(server&&server.exitCode===null){
    server.kill('SIGTERM');
    await Promise.race([once(server,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,1700))]);
  }
}
if(out.result!=='PASS')process.exitCode=1;
