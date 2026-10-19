// Actual Chromium customer UI -> actual localhost Node HTTP -> disposable PostgreSQL 16.
// Only search offers are intercepted source-derived fixtures; quote APIs are NEVER mocked.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync} from 'node:fs';
const db=process.env.NAWAA_TEST_DATABASE_URL,port=17894;
assert.equal(process.env.NODE_ENV,'test');
assert.equal(new URL(db).hostname,'127.0.0.1');
assert.equal(new URL(db).pathname,'/omega_ci');
const admin='omega_quote_disposable_admin_test_token_only_2026';
const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['server/server.mjs'],{env:{
  ...process.env,PORT:String(port),DATABASE_URL:'',MEILI_HOST:'',
  NAWAA_QUOTE_TEST_ENABLED:'1',NAWAA_QUOTE_TEST_ADMIN_TOKEN:admin,NAWAA_QUOTE_TEST_IDEMPOTENCY_SECRET:'omega-disposable-quote-hmac-'+String(2026).repeat(8)},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
let browser=null;
const fixture={offers:[{title:'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, White',
  merchant:'Jarir',merchantCountryCode:'SA',providerMarket:'jarir-sa',
  productPrice:2749,totalSAR:2749,currency:'SAR',condition:'new',
  availability:'unknown',exactMatch:true,matchConfidence:1,dataKind:'live',
  sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668744.html',
  observedAt:new Date().toISOString(),specs:{brand:'Sony',modelNumber:'CFI2116A01Y',storage:'1TB'}}],
  providers:[],providersConfigured:['jarir-direct'],errors:[],
  coverage:{partial:false,complete:true,providersPending:0},nextCursor:null};
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
 assert.ok(ready,'quote candidate server not ready: '+log.slice(-300));
 const executable=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);
 assert.ok(executable,'Chrome system binary missing');
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-SA'});
 await context.addInitScript(()=>{window.NAWAA_QUOTE_API_ENABLED=true;window.EventSource=undefined});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/\/api\/search\?/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}));
 await page.goto(origin+'/search.html?q=PS5',{waitUntil:'domcontentloaded'});
 await page.locator('.match-result-card').first().waitFor({timeout:25000});
 await page.locator('.match-result-card').first().click();
 await page.locator('#quoteBestBtn').waitFor({state:'visible',timeout:15000});
 await page.locator('#quoteBestBtn').click();
 await page.locator('#quoteRefreshBtn').waitFor({timeout:15000});
 const access=await page.evaluate(()=>JSON.parse(localStorage.getItem('nawaa_quote_access_last')||'null'));
 assert.ok(access?.id&&access?.token,'browser did not save customer tracking capability');
 assert.match(await page.locator('#quoteBody').innerText(),/بانتظار التسعير/);
 const quote=await fetch(origin+'/api/quote-admin/'+access.id+'/quote',{method:'POST',
  headers:{authorization:'Bearer '+admin,'content-type':'application/json'},
  body:JSON.stringify({priceSAR:'3399.50',etaDays:5,terms:'عرض تجريبي موثق بلا دفع',validForSeconds:3600})});
 assert.equal(quote.status,200);
 await page.locator('#quoteRefreshBtn').click();
 await page.locator('#quoteAcceptBtn').waitFor({timeout:15000});
 assert.match(await page.locator('#quoteBody').innerText(),/السعر المقترح/);
 await page.locator('#quoteAcceptBtn').click();
 await page.getByText('تم قبول التسعيرة').waitFor({timeout:15000});
 const final=await fetch(origin+'/api/quotes/'+access.id,{headers:{authorization:'Bearer '+access.token}});
 assert.equal(final.status,200);const accepted=await final.json();assert.equal(accepted.status,'accepted');assert.equal(accepted.priceSAR,3399.5);
 // Reopen actual candidate browser and recover quote access from its session.
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('#quoteResumeBtn').waitFor({state:'visible',timeout:15000});
 await page.locator('#quoteResumeBtn').click();
 await page.getByText('تم قبول التسعيرة').waitFor({timeout:15000});
 const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 assert.ok(mobile.scrollWidth<=mobile.width,'390px quote UI horizontal overflow');
 assert.deepEqual(errors,[],'browser JS errors');
 mkdirSync('browser-artifacts',{recursive:true});
 await page.screenshot({path:'browser-artifacts/quote-customer-390px.png'});
 console.log('REAL_QUOTE_CHROMIUM '+JSON.stringify({actualBrowser:true,viewport:390,
  actualHTTP:true,actualPostgres:true,sourceFixture:true,quoteTransportMocked:false,
  customerRequested:true,adminPriced:true,customerAccepted:true,customerReloadRecovery:true,
  mobileNoOverflow:true,errors:errors.length,productionTouched:false}));
}finally{if(browser)await browser.close();child.kill('SIGKILL')}
