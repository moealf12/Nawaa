// Browser-level customer journey checks against the real public NAWAA site
// or the exact PR HEAD running as an isolated localhost candidate.
// No login, payments, quotes, merchant checkout, database writes or deploys.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import net from 'node:net';

const mode=process.argv[2];
if(!['candidate','published'].includes(mode))throw Error('mode must be candidate or published');
const dir='browser-artifacts';
mkdirSync(dir,{recursive:true});
const report={mode,generatedAt:new Date().toISOString(),result:'INCOMPLETE',
  environment:mode==='candidate'?'isolated_pr_head':'currently_published_site',
  assertions:{},errors:[],consoleErrors:[],resourceFailures:[],deploymentClaim:false};
const query=process.env.NAWAA_BROWSER_QUERY || (mode==='candidate'?'iPhone 17':'PS5');
const prefix=dir+'/'+mode+'-'+query.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,35);
report.query=query;
let child=null,browser=null;
const env={...process.env,PORT:'0',NODE_ENV:'test',DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:'',
  NOON_ENABLED:'false',CARREFOUR_ENABLED:'false',EBAY_ENABLED:'false',
  SEARCH_STREAM_DEADLINE_MS:'10000',SEARCH_REQUEST_DEADLINE_MS:'12000'};
function sanitize(str){return String(str||'').replace(/https?:\/\/[^\s]+/g,'[url]').slice(0,200)}
async function startCandidate(){
  const port=await new Promise((resolve,reject)=>{
    const socket=net.createServer();
    socket.once('error',reject);
    socket.listen(0,'127.0.0.1',()=>{const p=socket.address().port;socket.close(()=>resolve(p))});
  });
  env.PORT=String(port);
  child=spawn(process.execPath,['server/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',()=>{});
  child.stderr.on('data',()=>{});
  const base='http://127.0.0.1:'+port;
  for(let i=0;i<140;i++){
    if(child.exitCode!==null)throw Error('candidate_exited_before_ready_'+child.exitCode);
    try{const h=await fetch(base+'/health',{signal:AbortSignal.timeout(800)});if(h.status===200)return base;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('candidate_health_timeout');
}
const desktop={width:1365,height:850};
let page=null;
try{
  const base=mode==='candidate'?await startCandidate():'https://moealf12.github.io/Nawaa';
  report.requestUrlBase=mode==='candidate'?'localhost_canonical_pr':'https://moealf12.github.io/Nawaa';
  const binary=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);
  if(!binary)throw Error('chromium_not_available_on_runner');
  browser=await chromium.launch({executablePath:binary,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:desktop,locale:'ar-SA',timezoneId:'Asia/Riyadh',
    ignoreHTTPSErrors:false,serviceWorkers:'block'});
  // Observe the SAME live SSE search used by the page: no duplicate merchant
  // request and no interception of actual application results.
  await context.addInitScript(() => {
    const Native = window.EventSource;
    if (!Native) return;
    const simplify = o => {
      let source = null;
      try { const u = new URL(o.sourceUrl || ""); source = u.protocol === "https:" ? u.origin + u.pathname : null; } catch {}
      return {
        title: String(o.title || "").slice(0,180),
        merchant: String(o.merchant || "").slice(0,65),
        source, productPrice: Number.isFinite(o.productPrice) ? o.productPrice : null,
        currency: o.currency, modelNumber: String(o.specs?.modelNumber || "").slice(0,80),
        manufacturer: String(o.specs?.brand || "").slice(0,60),
        sourceName: String(o.sourceMeta?.nameAr || "").slice(0,150),
        exactMatch: o.exactMatch === true,
        matchReason: String(o.matchReason || "").slice(0,150),
        providerMarket: String(o.providerMarket || "").slice(0,70)
      };
    };
    window.__nawaaObserved = {first:[],suspicious:[],done:false,snapshots:0};
    window.EventSource = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("snapshot", event => {
          try {
            const offers = JSON.parse(event.data)?.offers || [];
            const record = window.__nawaaObserved;
            record.snapshots++;
            if (!record.first.length && offers.length) record.first = offers.slice(0,10).map(simplify);
            for (const o of offers) {
              if (Number.isFinite(o.productPrice) && o.productPrice < 1000 &&
                !record.suspicious.some(x => x.source && x.source === simplify(o).source))
                record.suspicious.push(simplify(o));
              if(record.suspicious.length>=14)break;
            }
          } catch {}
        });
        this.addEventListener("done",()=>{window.__nawaaObserved.done=true;});
      }
    };
  });
  page=await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror',err=>report.consoleErrors.push(sanitize(err.message)));
  page.on('requestfailed',req=>{
    if(report.resourceFailures.length<15)report.resourceFailures.push({
      type:req.resourceType(),reason:sanitize(req.failure()?.errorText)});
  });
  const began=performance.now();
  const url=base+'/search.html?q='+encodeURIComponent(query);
  const navigation=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  report.navigation={httpStatus:navigation?.status()||null,elapsedMs:Math.round(performance.now()-began)};
  await page.waitForFunction(()=>{
    const results=document.querySelector('#results');
    const status=document.querySelector('#searchStatus')?.textContent||'';
    return Boolean(results?.querySelector('.match-result-card,.no-match,.live-search-error')) ||
      /تعذر الاتصال|حدث خطأ|غير متاح|فشل الاتصال/.test(status);
  },null,{timeout:55000});
  report.results=await page.evaluate(()=>{
    const result=document.querySelector('#results');
    return {cards:result?.querySelectorAll('.match-result-card').length||0,
      status:document.querySelector('#searchStatus')?.textContent?.slice(0,320)||'',
      noMatch:Boolean(result?.querySelector('.no-match')),
      priceLabels:[...result?.querySelectorAll('.match-card-price b')||[]].slice(0,6).map(x=>x.textContent?.trim()),
      cardTitles:[...result?.querySelectorAll('.match-card-copy strong')||[]].slice(0,6).map(x=>x.textContent?.trim()),
      cardCoverage:[...result?.querySelectorAll('.card-coverage')||[]].slice(0,6).map(x=>x.textContent?.trim()),
      merchantOffers:result?.querySelectorAll('.merchant-row').length||0,
      remoteExpand:Boolean(result?.querySelector('#loadMoreRemote')),
      categoryExpand:result?.querySelectorAll('.show-category').length||0};
  });
  report.firstVisibleResultsMs=Math.round(performance.now()-began);
  if (/ps5/i.test(query)) {
    // Capture product identity from the very same SSE event the shopper saw.
    // Wait only for existing stream completion; never initiate another search.
    await page.waitForFunction(() => window.__nawaaObserved?.done, null, {timeout:22000}).catch(()=>{});
    report.ps5SourceEvidence=await page.evaluate(()=>window.__nawaaObserved);
  }
  await page.screenshot({path:prefix+'-search-desktop.png',fullPage:true,timeout:20000});
  report.assertions.searchPageRendered=Boolean(navigation?.ok());
  report.assertions.realOfferCards=report.results.cards>0;
  if(report.results.cards>0){
    const card=page.locator('#results .match-result-card').first();
    await card.click();
    await page.locator('#results .selected-comparison[open]').waitFor({timeout:10000});
    const compare=await page.evaluate(()=>{
      const comp=document.querySelector('#results .selected-comparison[open]');
      return {opened:Boolean(comp),heading:comp?.querySelector('.comparison-head h4')?.textContent?.trim()||'',
        caveat:comp?.querySelector('.model-identity-note')?.textContent?.trim()||'',
        offerRows:comp?.querySelectorAll('.merchant-row').length||0,
        details:comp?.querySelectorAll('.product-detail-btn').length||0};
    });
    report.comparison=compare;
    report.assertions.comparisonOpened=compare.opened;
    report.assertions.productDetailsAvailable=compare.details>0;
    if(mode==='candidate'){
      report.assertions.noUnverifiedSameSkuClaim=!/نفس النسخة، بين المتاجر/.test(compare.heading);
      report.assertions.identityQualifier=Boolean(compare.caveat);
    }
    await page.screenshot({path:prefix+'-comparison-desktop.png',fullPage:true,timeout:20000});
  }
  const imageQA=await page.evaluate(()=>{
    const cards=[...document.querySelectorAll('.match-card-image')].slice(0,10);
    const details=cards.map(card=>{
      const img=card.querySelector('img'),fallback=card.querySelector('.match-card-fallback');
      if(!img)return {state:'no-image',fallbackVisible:!!fallback&&getComputedStyle(fallback).display!=='none'};
      return {state:img.complete?(img.naturalWidth>0?'loaded':'broken'):'pending',
        fallbackVisible:!!fallback&&getComputedStyle(fallback).display!=='none'};
    });
    return {tested:details.length,loaded:details.filter(x=>x.state==='loaded').length,
      broken:details.filter(x=>x.state==='broken').length,
      pending:details.filter(x=>x.state==='pending').length,
      brokenWithoutFallback:details.filter(x=>x.state==='broken'&&!x.fallbackVisible).length,
      noImageWithoutFallback:details.filter(x=>x.state==='no-image'&&!x.fallbackVisible).length};
  });
  report.imageQA=imageQA;
  report.assertions.imageFallbackSafe=imageQA.brokenWithoutFallback===0&&imageQA.noImageWithoutFallback===0;
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(500);
  const mobile=await page.evaluate(()=>({viewport:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
    cards:document.querySelectorAll('#results .match-result-card').length,
    title:document.querySelector('h1')?.textContent?.trim()?.slice(0,100)}));
  report.mobile=mobile;
  report.assertions.mobileNoHorizontalOverflow=mobile.scrollWidth<=mobile.viewport+4;
  await page.screenshot({path:prefix+'-search-mobile.png',fullPage:true,timeout:20000});
  report.result=Object.values(report.assertions).every(Boolean)?'PASS':'FAIL';
}catch(error){
  report.errors.push(sanitize(error.message));report.result='FAIL';
  if(page){try{await page.screenshot({path:prefix+'-failure.png',fullPage:true,timeout:6000})}catch{}}
}finally{
  writeFileSync(prefix+'-report.json',JSON.stringify(report,null,2));
  console.log('NAWAA_REAL_BROWSER_JOURNEY '+JSON.stringify(report));
  if(browser)await browser.close().catch(()=>{});
  if(child&&child.exitCode===null){
    child.kill('SIGTERM');
    await Promise.race([once(child,'exit').catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1700))]);
  }
}
if(report.result!=='PASS')process.exitCode=1;
