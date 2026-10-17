// Real Chromium interactions against the exact PR website with fixed SSE
// fixtures. No merchant/network searches: every search API call is intercepted.
// Exercises actual browser DOM, event listeners, card expansion, pagination
// gestures, filters, customer navigation and error/empty displays.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import net from 'node:net';

if(process.env.NODE_ENV !== 'test') throw Error('fixture_browser_requires_test_env');
mkdirSync('browser-artifacts',{recursive:true});
const summary={result:'INCOMPLETE',kind:'isolated_browser_fixture',checks:{},counts:{},
  cases:[],images:{},errors:[],screenshotPaths:[]};
let child=null,browser=null;
const binary=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);
if(!binary)throw Error('system_chromium_unavailable');
function assertCheck(label,ok,details) {
  summary.checks[label]=Boolean(ok);
  if(!ok)summary.errors.push({check:label,details});
}
function offer(i) {
  const n=String(i).padStart(2,'0');
  return {
    merchant:i%2?'Jarir':'eXtra',merchantCountryCode:'SA',
    merchantCountryNameAr:'السعودية',providerMarket:i%2?'jarir-sa':'extra-sa',
    title:'HP Pavilion Laptop Model '+n+' 512GB Silver',
    productPrice:Math.round(2450+i*13),currency:'SAR',
    image:i===1?'https://nawaa-fixture.invalid/blocked-product.jpg':null,
    sourceUrl:'https://www.example.org/laptop-'+n,
    observedAt:'2026-10-17T12:00:00.000Z',condition:'new',
    availability:'in_stock',canShipToSaudi:true,
    shipping:null,importCost:0,tax:0,mandatoryFees:0,discount:0,
    dataKind:'live',exactMatch:true,matchConfidence:1,priceConfidence:'verified',
    specs:{brand:'HP',deviceType:'Laptop',modelNumber:'HP-LAP-'+n,
      storage:'512GB',color:'Silver'},
  };
}
const initial=Array.from({length:25},(_,i)=>offer(i+1));
const extra=Array.from({length:5},(_,i)=>offer(i+26));
const corsHeaders={'access-control-allow-origin':'*'};
function searchPayload(q,cursor) {
  if(q.includes('fixture-iphone-models')) {
    const template=offer(1);
    const first={...template,merchant:'eXtra',title:'Apple iPhone 17 256GB Black',
      sourceUrl:'https://www.example.org/iphone-model-a',
      specs:{brand:'Apple',deviceType:'iPhone 17',storage:'256GB',color:'Black',modelNumber:'MG674AH/A'}};
    const second={...first,merchant:'Jarir',
      sourceUrl:'https://www.example.org/iphone-model-b',
      specs:{...first.specs,modelNumber:'MG674LL/A'}};
    return {offers:[first,second],errors:[],providers:[],
      coverage:{partial:false,deadlineExceeded:false,providersPending:0},nextCursor:null};
  }
  if(q.includes('fixture-detail-pending')) return {
    offers:[{...offer(5),image:'https://nawaa-detail-pending.invalid/photo.png'}],
    errors:[],providers:[],coverage:{partial:false,deadlineExceeded:false,providersPending:0},
    nextCursor:null};
  if(q.includes('fixture-detail-loaded')) return {
    offers:[{...offer(5),image:'https://nawaa-detail-loaded.invalid/photo.svg'}],
    errors:[],providers:[],coverage:{partial:false,deadlineExceeded:false,providersPending:0},
    nextCursor:null};
  if(q.includes('fixture-pending-image')) return {
    offers:[{...offer(5),image:'https://nawaa-pending.invalid/delayed-product.jpg'}],
    errors:[],providers:[],coverage:{partial:false,deadlineExceeded:false,providersPending:0},
    nextCursor:null};
  if(q.includes('fixture-no-results')) return {
    offers:[],errors:[],providers:[],coverage:{partial:false,deadlineExceeded:false,providersPending:0},
    nextCursor:null};
  if(q.includes('fixture-partial')) return {
    offers:[],errors:[{sourceId:'optional-storefront',error:'merchant_unavailable'}],
    providers:[],coverage:{partial:true,deadlineExceeded:false,providersPending:0},
    nextCursor:'signed-test-depth-1'};
  if(cursor) return {
    offers:extra,errors:[],providers:[],
    coverage:{partial:false,deadlineExceeded:false,providersPending:0},
    nextCursor:null};
  return {
    offers:initial,errors:[],providers:[],
    coverage:{partial:false,deadlineExceeded:false,providersPending:0},
    nextCursor:'signed-test-depth-1'};
}
let searchRequests=0,cursorRequests=0,blockedImages=0;
function testQuery(url) {return new URL(url).searchParams.get('q')||'';}
let page=null;
try{
  const port=await new Promise((resolve,reject)=>{
    const sock=net.createServer();sock.once('error',reject);
    sock.listen(0,'127.0.0.1',()=>{const x=sock.address().port;sock.close(()=>resolve(x));});
  });
  child=spawn(process.execPath,['server/server.mjs'],{
    env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:'',
      MEILI_HOST:'',MEILI_MASTER_KEY:'',NOON_ENABLED:'false',
      CARREFOUR_ENABLED:'false',EBAY_ENABLED:'false'},
    stdio:['ignore','pipe','pipe']
  });
  child.stderr.on('data',()=>{});
  child.stdout.on('data',()=>{});
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<110;i++){
    if(child.exitCode!==null)throw Error('fixture_candidate_exited');
    try{const response=await fetch(base+'/health',{signal:AbortSignal.timeout(750)});
      if(response.ok){ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw Error('fixture_candidate_health_timeout');
  browser=await chromium.launch({executablePath:binary,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1280,height:820},locale:'ar-SA',serviceWorkers:'block'});
  const browserErrors=[];
  context.on('page',tab=>tab.on('pageerror',e=>browserErrors.push(e.message.slice(0,140))));
  await context.route(url => {
    const u=new URL(url);return u.hostname==='nawaa-fixture.invalid';
  },async route=>{blockedImages++;await route.abort('blockedbyclient')});
  await context.route(url=>{
    const u=new URL(url);return u.hostname==='127.0.0.1'&&(u.pathname==='/api/search'||u.pathname==='/api/search/stream');
  },async route=>{
    const requestUrl=route.request().url(),u=new URL(requestUrl);
    searchRequests++;
    if(u.searchParams.has('cursor'))cursorRequests++;
    const q=testQuery(requestUrl),payload=searchPayload(q,u.searchParams.get('cursor'));
    if(u.pathname.endsWith('/stream')) {
      const body='event: snapshot\n'+'data: '+JSON.stringify(payload)+'\n\n'+'event: done\n'+'data: {}\n\n';
      await route.fulfill({status:200,contentType:'text/event-stream; charset=utf-8',headers:corsHeaders,body});
    }else{
      await route.fulfill({status:200,contentType:'application/json',headers:corsHeaders,
        body:JSON.stringify(payload)});
    }
  });
  let releasePendingImage=null;
  const pendingImageGate=new Promise(resolve=>{releasePendingImage=resolve;});
  await context.route(url => new URL(url).hostname==='nawaa-pending.invalid', async route=>{
    await pendingImageGate;
    await route.abort('failed');
  });
  let releaseDetailImage=null;
  const detailImageGate=new Promise(resolve=>{releaseDetailImage=resolve;});
  await context.route(url=>new URL(url).hostname==='nawaa-detail-pending.invalid',async route=>{
    await detailImageGate;
    await route.abort('failed');
  });
  await context.route(url=>new URL(url).hostname==='nawaa-detail-loaded.invalid',async route=>{
    await route.fulfill({status:200,contentType:'image/svg+xml',
      body:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#2563eb"/></svg>'});
  });
  async function navigate(q){
    const tab=await context.newPage();
    tab.setDefaultTimeout(10000);
    await tab.goto(base+'/search.html?q='+encodeURIComponent(q),{waitUntil:'domcontentloaded'});
    return tab;
  }
  page=await navigate('HP');
  await page.locator('#results .match-result-card').first().waitFor({timeout:15000});
  const count=()=>page.locator('#results .match-result-card').count();
  const n10=await count();assertCheck('first_10_product_cards',n10===10,n10);
  await page.screenshot({path:'browser-artifacts/fixture-hp-10-desktop.png',fullPage:true});
  const btn=page.locator('#results button.show-category[data-show-category]').first();
  await btn.click();
  const n20=await count();assertCheck('load_more_10_to_20',n20===20,n20);
  await page.screenshot({path:'browser-artifacts/fixture-hp-20-desktop.png',fullPage:true});
  await page.locator('#results button.show-category[data-show-category]').first().click();
  const n25=await count();assertCheck('load_more_20_to_25',n25===25,n25);
  summary.counts={n10,n20,n25};
  await page.screenshot({path:'browser-artifacts/fixture-hp-25-desktop.png',fullPage:true});
  assertCheck('no_third_local_load_more',(await page.locator('#results button.show-category[data-show-category]').count())===0);
  await page.locator('#merchantFilter').selectOption('eXtra');
  const filtered=await count();
  assertCheck('merchant_filter_applied',filtered===10,{filtered});
  await page.locator('#resetResultFilters').click();
  assertCheck('reset_filters_restores_initial_10',await count()===10);
  await page.locator('#results .match-result-card').first().click();
  await page.locator('.selected-comparison[open]').waitFor();
  const heading=await page.locator('.selected-comparison[open] .comparison-head h4').textContent();
  const modelWarning=await page.locator('.selected-comparison[open] .model-identity-note').textContent();
  assertCheck('honest_merchant_comparison_heading',heading.includes('مقارنة عروض النسخة المختارة'));
  assertCheck('model_sku_caveat_visible',modelWarning.includes('لا تتوفر أدلة كافية'));
  await page.screenshot({path:'browser-artifacts/fixture-hp-comparison-desktop.png',fullPage:true});
  await page.locator('.selected-comparison[open] .product-detail-btn').first().click();
  await page.waitForURL(/product\.html\?/, {timeout:12000});
  assertCheck('product_details_page_navigation',page.url().includes('/product.html?source='));
  const destination=new URL(page.url());
  assertCheck('selected_merchant_source_preserved',destination.searchParams.get('source')?.startsWith('https://www.example.org/laptop-'));
  const beforePages=searchRequests;
  let partial=await navigate('fixture-partial');
  await partial.locator('#results .no-match').waitFor({timeout:12000});
  const partialText=(await partial.locator('#results').innerText())||'';
  assertCheck('partial_search_exposes_source_failure',partialText.includes('تعذر التحقق من بعض المصادر'));
  assertCheck('partial_search_not_falsely_out_of_stock',partialText.includes('لا يعني أن المنتج غير متوفر'));
  assertCheck('partial_search_no_automatic_cursor',cursorRequests===0,{cursorRequests});
  await partial.screenshot({path:'browser-artifacts/fixture-partial-desktop.png',fullPage:true});
  const clean=await navigate('fixture-no-results');
  await clean.locator('#results .no-match').waitFor();
  const cleanText=await clean.locator('#results').innerText();
  assertCheck('honest_empty_no_results',cleanText.includes('ما ظهر لنا عرض حي'));
  assertCheck('empty_not_misleading_partial',!cleanText.includes('تعذر التحقق من بعض المصادر'));
  await clean.screenshot({path:'browser-artifacts/fixture-empty-desktop.png',fullPage:true});
  const remaining=await navigate('HP');
  await remaining.locator('#results .match-result-card').first().waitFor();
  const remote=remaining.locator('#loadMoreRemote');
  await remote.waitFor({timeout:10000});
  const current=cursorRequests;
  await remote.click();
  await remaining.waitForTimeout(1200);
  const expansionDebug=await remaining.evaluate(()=>({
    status:document.querySelector('#searchStatus')?.textContent||'',
    hasRemoteButton:Boolean(document.querySelector('#loadMoreRemote')),
    cards:document.querySelectorAll('#results .match-result-card').length,
    notice:document.querySelector('#results .search-notice')?.textContent||'',
  }));
  summary.remoteExpansion={...expansionDebug,cursorRequests};
  assertCheck('signed_cursor_customer_initiated_fetch',cursorRequests===current+1,
    {cursorRequests,before:current});
  const after=await remaining.locator('#results .match-result-card').count();
  assertCheck('remote_expansion_no_loss_or_truncation',after===10,{after});
  const remoteStatus=await remaining.locator('#searchStatus').innerText();
  assertCheck('remote_expansion_added_5',/أضفنا 5 عرضًا جديدًا|30 عرضًا/.test(remoteStatus),remoteStatus);
  await remaining.screenshot({path:'browser-artifacts/fixture-remote-expanded.png',fullPage:true});
  // A stalled external CDN must not leave a silent blank image tile:
  // the accessible placeholder should be visible until an image loads.
  const pendingTab=await navigate('fixture-pending-image');
  const pendingImage=pendingTab.locator('.match-card-image img[src*="nawaa-pending.invalid"]');
  await pendingImage.scrollIntoViewIfNeeded();
  await pendingTab.waitForFunction(()=>{
    const image=document.querySelector('.match-card-image img[src*="nawaa-pending.invalid"]');
    return image&&!image.complete;
  },null,{timeout:10000});
  const pendingState=await pendingTab.evaluate(()=>{
    const image=document.querySelector('.match-card-image img[src*="nawaa-pending.invalid"]');
    const fallback=image.nextElementSibling;
    return {pending:!image.complete,fallbackDisplay:getComputedStyle(fallback).display,
      fallbackText:fallback.textContent.trim()};
  });
  assertCheck('pending_cdn_image_keeps_visible_fallback',
    pendingState.pending&&pendingState.fallbackDisplay==='grid'&&
    pendingState.fallbackText.includes('صورة غير متاحة'),pendingState);
  await pendingTab.screenshot({path:'browser-artifacts/fixture-pending-cdn-image.png',fullPage:true});
  // Selected comparison uses a distinct image renderer, not the search-card
  // tile. The same stalled CDN must not produce an empty comparison hero.
  await pendingTab.locator('#results .match-result-card').first().click();
  await pendingTab.locator('.selected-comparison[open] .config-image img').waitFor();
  const pendingComparisonImage=await pendingTab.evaluate(()=>{
    const image=document.querySelector('.selected-comparison[open] .config-image img');
    const tile=image?.closest('.config-image');
    const fallback=image?.nextElementSibling;
    const rect=tile?.getBoundingClientRect(),child=fallback?.getBoundingClientRect();
    return {pending:!image?.complete,display:fallback?getComputedStyle(fallback).display:null,
      centered:!!rect&&!!child&&child.width>=rect.width-3&&child.height>=rect.height-3,
      alt:image?.getAttribute('alt')};
  });
  assertCheck('pending_selected_comparison_image_fallback_visible',
    pendingComparisonImage.pending&&pendingComparisonImage.display==='grid'&&
    pendingComparisonImage.centered,pendingComparisonImage);
  await pendingTab.setViewportSize({width:390,height:844});
  const pendingComparisonMobile=await pendingTab.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    display:getComputedStyle(document.querySelector('.selected-comparison[open] .config-image-fallback')).display
  }));
  assertCheck('pending_comparison_mobile_no_overflow',
    pendingComparisonMobile.scrollWidth<=pendingComparisonMobile.viewport+4,
    pendingComparisonMobile);
  await pendingTab.screenshot({path:'browser-artifacts/fixture-pending-comparison-mobile.png',fullPage:true});
  releasePendingImage?.();
  await pendingTab.waitForFunction(()=>{
    const image=document.querySelector('.match-card-image img[src*="nawaa-pending.invalid"]');
    return image?.complete&&image.naturalWidth===0&&
      getComputedStyle(image.nextElementSibling).display==='grid';
  },null,{timeout:10000});
  assertCheck('pending_image_failure_retains_fallback',true);
  // Walk the same customer path into the ACTUAL product.html page while
  // the independently intercepted product-detail image remains pending.
  const detailPending=await navigate('fixture-detail-pending');
  await detailPending.locator('#results .match-result-card').first().click();
  await detailPending.locator('.selected-comparison[open] .product-detail-btn').first().click();
  await detailPending.waitForURL(/product\\.html\\?/,{waitUntil:'domcontentloaded',timeout:12000});
  await detailPending.locator('.product-media img').waitFor();
  const detailBefore=await detailPending.evaluate(()=>{
    const img=document.querySelector('.product-media img');
    const fb=document.querySelector('.product-media .media-fallback');
    return {pending:!img.complete,visible:!fb.hidden&&getComputedStyle(fb).display!=='none',
      fallbackText:fb.textContent.trim(),status:fb.getAttribute('role'),
      model:document.querySelector('.model-line')?.textContent?.trim(),
      merchant:document.querySelector('.source-line')?.textContent?.trim(),
      title:document.querySelector('.product-copy h1')?.textContent?.trim(),
      price:document.querySelector('.price-block strong')?.textContent?.trim(),
      observedAt:document.querySelector('.source-card p')?.textContent?.trim()};
  });
  assertCheck('pending_detail_hero_shows_truthful_loading_fallback',
    detailBefore.pending&&detailBefore.visible&&
    detailBefore.fallbackText.includes('جاري تحميل صورة')&&
    detailBefore.status==='status',detailBefore);
  assertCheck('detail_merchant_model_price_provenance_preserved',
    detailBefore.title==='HP Pavilion Laptop Model 05 512GB Silver'&&
    detailBefore.model?.includes('HP-LAP-05')&&
    detailBefore.merchant?.includes('Jarir')&&
    detailBefore.price?.includes(new Intl.NumberFormat('ar-SA').format(2515))&&
    detailBefore.observedAt?.includes('آخر رصد'),detailBefore);
  await detailPending.screenshot({path:'browser-artifacts/fixture-detail-image-pending-desktop.png',fullPage:true});
  await detailPending.setViewportSize({width:390,height:844});
  const detailMobile=await detailPending.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    visible:!document.querySelector('.product-media .media-fallback').hidden}));
  assertCheck('pending_detail_mobile_no_overflow',
    detailMobile.scrollWidth<=detailMobile.viewport+4&&detailMobile.visible,detailMobile);
  await detailPending.screenshot({path:'browser-artifacts/fixture-detail-image-pending-mobile.png',fullPage:true});
  releaseDetailImage();
  await detailPending.waitForFunction(()=>{
    const img=document.querySelector('.product-media img');
    return img.complete&&img.naturalWidth===0&&
      getComputedStyle(img).display==='none'&&
      !document.querySelector('.product-media .media-fallback').hidden;
  },null,{timeout:12000});
  assertCheck('detail_image_failure_shows_fallback',
    (await detailPending.locator('.product-media .media-fallback').textContent()).includes('تعذر تحميل'));

  const detailLoaded=await navigate('fixture-detail-loaded');
  await detailLoaded.locator('#results .match-result-card').first().click();
  await detailLoaded.locator('.selected-comparison[open] .product-detail-btn').first().click();
  await detailLoaded.waitForURL(/product\\.html\\?/,{waitUntil:'domcontentloaded',timeout:12000});
  await detailLoaded.waitForFunction(()=>{
    const img=document.querySelector('.product-media img');
    return img?.complete&&img.naturalWidth>0;
  },null,{timeout:12000});
  const success=await detailLoaded.evaluate(()=>{
    const img=document.querySelector('.product-media img'),fb=img.nextElementSibling;
    return {loaded:img.naturalWidth>0,hidden:fb.hidden,
      imageVisible:getComputedStyle(img).display!=='none'};
  });
  assertCheck('successful_detail_image_no_fallback',success.loaded&&success.hidden&&success.imageVisible,success);
  await detailLoaded.screenshot({path:'browser-artifacts/fixture-detail-image-success-desktop.png',fullPage:true});
  // Explicitly simulate a browser-visible broken image without accessing a
  // third-party CDN. Onerror must reveal visible fallback.
  const imgTab=await navigate('HP');
  const img=imgTab.locator('.match-card-image img').first();
  await imgTab.locator('.match-card-image').first().scrollIntoViewIfNeeded();
  await imgTab.waitForFunction(()=>{
    const img=document.querySelector('.match-card-image img');
    const fb=img?.nextElementSibling;
    return img?.complete && img.naturalWidth===0 &&
      getComputedStyle(img).display==='none' &&
      getComputedStyle(fb).display==='grid';
  },null,{timeout:12000});
  assertCheck('blocked_cdn_image_uses_visible_fallback',true);
  await imgTab.setViewportSize({width:390,height:844});
  const mobile=await imgTab.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    fallback:getComputedStyle(document.querySelector('.match-card-image img').nextElementSibling).display}));
  assertCheck('mobile_no_horizontal_overflow',mobile.scrollWidth<=mobile.viewport+4,mobile);
  assertCheck('mobile_image_fallback_visible',mobile.fallback==='grid',mobile);
  await imgTab.screenshot({path:'browser-artifacts/fixture-mobile-image-fallback.png',fullPage:true});
  // The same visible phone/model/storage/color may have DIFFERENT manufacturer
  // codes: preserve separate groups, and show the distinguishing codes.
  const duplicated=await navigate('fixture-iphone-models');
  await duplicated.locator('#results .match-result-card').first().waitFor();
  const duplicateCards=duplicated.locator('#results .match-result-card');
  const duplicateCount=await duplicateCards.count();
  const labels=await duplicated.locator('#results .card-model-identifier').allTextContents();
  const titles=await duplicated.locator('#results .match-card-copy strong').allTextContents();
  assertCheck('identical_phone_label_but_distinct_skus_stay_separate',duplicateCount===2,
    {duplicateCount,titles});
  assertCheck('iphone_ambiguous_variant_labels_disclose_model_codes',
    labels.length===2&&labels.some(x=>x.includes('MG674AH/A'))&&
    labels.some(x=>x.includes('MG674LL/A')),{labels});
  assertCheck('phone_identity_not_merged_by_title',
    new Set(titles.map(x=>x.toLowerCase().trim())).size===1,{titles});
  await duplicated.screenshot({path:'browser-artifacts/fixture-iphone-distinct-sku-cards.png',fullPage:true});
  assertCheck('no_browser_script_errors',browserErrors.length===0,browserErrors);
  summary.counts={...summary.counts,filtered,searchRequests,cursorRequests,blockedImages};
  summary.mobile=mobile;
  summary.result=Object.values(summary.checks).every(Boolean)?'PASS':'FAIL';
}catch(error){
  summary.errors.push({unhandled:String(error?.stack||error).slice(0,950)});
  summary.result='FAIL';
  if(page){try{await page.screenshot({path:'browser-artifacts/fixture-error.png',fullPage:true,timeout:7000})}catch{}}
}finally{
  writeFileSync('browser-artifacts/fixture-customer-acceptance.json',JSON.stringify(summary,null,2));
  console.log('NAWAA_FIXTURE_CUSTOMER_ACCEPTANCE '+JSON.stringify(summary));
  if(browser)await browser.close().catch(()=>{});
  if(child && child.exitCode===null){
    child.kill('SIGTERM');await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,1200))]);
  }
}
if(summary.result!=='PASS')process.exitCode=1;
