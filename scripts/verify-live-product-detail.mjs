// v21.82: READ-ONLY public-production synthetic customer journey.
// Never sends merchant requests, credentials, account data, or quote submissions.
// A live HTTP/DOM smoke is not live product authenticity, P95, or a badge certificate.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';

const origin='https://nawaa-search-api.onrender.com';
const target=origin+'/product.html';
const fixture={
  title:'SYNTHETIC CI HP Pavilion Laptop',
  merchant:'Jarir',merchantCountryCode:'SA',merchantCountryNameAr:'السعودية',
  sourceUrl:'https://www.jarir.com/ci-synthetic-do-not-buy',
  productPrice:2999,currency:'SAR',condition:'new',dataKind:'test',
  specs:{
    brand:'HP',ram:'No',storage:'512GB',processor:'undefined',
    waterproof:false,modelNumber:'HP-TEST-512',barcode:'TEST-0001'
  }
};
const start=Date.now();
for(const [path,needle,mime] of [
  ['/product.html','src/product-page.mjs','text/html'],
  ['/src/product-page.mjs','visibleProductDetailSpecifications','javascript'],
  ['/src/product-card-presentation.mjs','displayProductSpecification','javascript']
]){
  const response=await fetch(origin+path,{signal:AbortSignal.timeout(70_000)});
  assert.equal(response.status,200,path+' must be served by production');
  assert.match(response.headers.get('content-type')||'',new RegExp(mime),path+' MIME');
  assert.ok((await response.text()).includes(needle),path+' expected shipped content');
}
const executablePath=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);
assert.ok(executablePath,'isolated CI runner must provide a Chromium executable');
const browser=await chromium.launch({headless:true,executablePath,
  args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const context=await browser.newContext({locale:'ar-SA',viewport:{width:390,height:844}});
  const page=await context.newPage();
  const failures=[];
  page.on('pageerror',error=>failures.push(error.message));
  await page.route('**/*',route=>{
    const url=route.request().url();
    return url.startsWith(origin+'/')?route.continue():route.abort();
  });
  await page.addInitScript(value=>{
    sessionStorage.setItem('nawaa_product_detail',JSON.stringify({
      query:'isolated synthetic product-detail smoke',product:{},offer:value
    }));
  },fixture);
  const response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000});
  assert.equal(response?.status(),200,'actual Render product page HTTP status');
  await page.locator('#quoteBtn').waitFor({state:'visible',timeout:25000});
  const results=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('.spec-table > div')].map(el=>el.innerText);
    return {
      rows,
      model:document.querySelector('.model-line')?.innerText||'',
      title:document.querySelector('h1')?.innerText||'',
      quote:window.NAWAA_QUOTE_URL
    };
  });
  assert.match(results.title,/SYNTHETIC CI HP Pavilion/);
  assert.match(results.model,/HP-TEST-512/);
  assert.ok(results.rows.some(row=>row.includes('السعة')&&row.includes('512GB')));
  assert.ok(results.rows.some(row=>row.includes('مقاومة الماء')&&row.includes('لا')));
  assert.ok(results.rows.some(row=>row.includes('رقم الموديل')&&row.includes('HP-TEST-512')));
  assert.ok(!results.rows.some(row=>row.includes('الذاكرة RAM')),
    'invalid RAM placeholder must never be presented');
  assert.ok(!results.rows.some(row=>row.includes('المعالج')),
    'undefined is not a customer-visible CPU specification');
  assert.equal(failures.length,0,'browser page/module errors: '+failures.join('; '));
  assert.ok(typeof results.quote==='string'&&results.quote.startsWith('https://'),
    'quote CTA must remain configured');
  // Observe navigation request but do NOT send or complete a quote or request
  // to the external quotation site; all cross-origin requests are aborted.
  const nextRequest=page.waitForEvent('request',request=>
    request.url().startsWith(results.quote),{timeout:7000});
  await page.locator('#quoteBtn').click();
  const quoteRequest=await nextRequest;
  const quoteURL=new URL(quoteRequest.url());
  const quoteText=quoteURL.searchParams.get('request')||'';
  assert.match(quoteText,/SYNTHETIC CI HP Pavilion/);
  assert.match(quoteText,/HP-TEST-512/);
  assert.ok(!quoteText.includes('undefined'),'quote handoff cannot include invalid placeholder');
  console.log('LIVE_PRODUCT_DETAIL_SMOKE '+JSON.stringify({
    result:'PASS',source:'public Render HTTP plus real isolated Chromium',
    syntheticFixture:true,merchantAuthenticityCertified:false,productionP95Certified:false,
    productHtmlStatus:200,jsModulesStatus:200,mobileViewport:'390x844',
    specRows:results.rows.length,quoteAttemptIntercepted:true,elapsedMs:Date.now()-start
  }));
  await context.close();
}finally{await browser.close();}
