// Real Chromium interactions against the exact PR website with fixed SSE
// fixtures. No merchant/network searches: every search API call is intercepted.
// Exercises actual browser DOM, event listeners, card expansion, pagination
// gestures, filters, customer navigation and error/empty displays.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import net from 'node:net';
import {assessOfferMatch,describeProduct} from '../src/search-query.mjs';

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
  if(q==='PS5 Slim'){
    // v15.18 E1: real Jarir category records from 2026-10-18.
    // Intercepted browser fixture, NOT real-time stock evidence.
    const rows=[
      ['627671','CFI2016B01Y',2529,'Sony PlayStation 5 Slim (DIG) 1 TB, White'],
      ['627678','CFI2016A01Y',2749,'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, White'],
      ['670688','CFI2116AFNTVC',2299,'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with Fornite Flowering Chaos, White'],
      ['677770','CFI2116ACFIZC',3049,'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with DualSense Wireless Controller, White']
    ];
    const paths={
      '627671':'sony-playstation-5-gaming-consoles-and-handheld-627671.html',
      '627678':'sony-playstation-5-gaming-consoles-and-handheld-627678.html',
      '670688':'sony-playstation-5-slim-gaming-consoles-and-handheld-670688.html',
      '677770':'sony-playstation-5-slim-gaming-consoles-and-handheld-677770.html'
    };
    const offers=rows.map(([sku,mpn,price,title])=>{
      const item={
        merchant:'Jarir',provider:'jarir-direct',providerMarket:'jarir-sa',
        merchantCountryCode:'SA',merchantCountryNameAr:'السعودية',
        title,productPrice:price,currency:'SAR',condition:'new',
        // Constructor 677770 remains stock UNKNOWN; only the other three
        // have verified InStock evidence from the official public category.
        availability:sku==='677770'?'unknown':'in_stock',
        image:null,sourceUrl:'https://www.jarir.com/sa-en/'+paths[sku],
        sourceMeta:{productId:sku,parsedFrom:sku==='677770'?'jarir-constructor-search':'jarir-category-jsonld'},
        specs:{brand:'Sony',modelNumber:mpn},
        observedAt:'2026-10-18T09:28:52.823Z',
        dataKind:'live',
      };
      return {...item,...assessOfferMatch(q,item)};
    });
    return {offers,errors:[],providers:[],
      coverage:{partial:false,deadlineExceeded:false,providersPending:0},
      nextCursor:null};
  }
  // v15.17: authentic 2026-10-18 Jarir SKU/MPN/price/title in intercepted
  // browser fixtures; explicitly not a fresh merchant stock observation.
  if(q==='PS5 DualSense Bundle'||q==='بلايستيشن 5 مع يد إضافية'){
    const specs=[
      ['677770','CFI2116ACFIZC',3049,'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with DualSense Wireless Controller, White'],
      ['670688','CFI2116AFNTVC',2299,'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with Fornite Flowering Chaos, White'],
    ];
    const packages=specs.map(([sku,model,productPrice,title])=>({
      merchant:'Jarir',providerMarket:'jarir-sa',merchantCountryCode:'SA',
      title,productPrice,currency:'SAR',condition:'new',availability:'in_stock',
      sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-'+sku+'.html',
      sourceMeta:{productId:sku,parsedFrom:'jarir-category-jsonld'},
      specs:{brand:'Sony',modelNumber:model},image:null,dataKind:'live'
    }));
    const controller={...offer(5),merchant:'Fixture Accessory',
      title:'Sony PS5 DualSense Wireless Controller',productPrice:249,
      sourceUrl:'https://www.example.org/fixture-standalone-controller',image:null};
    const offers=[...packages,controller].map(o=>({...o,...assessOfferMatch(q,o)}));
    return {offers,errors:[],providers:[],
      coverage:{partial:false,deadlineExceeded:false,providersPending:0},
      nextCursor:null};
  }
  // Merchant-derived regression for the exact product that was incorrectly
  // certified as a console in the real 2026-10-17 candidate SSE.
  if(/^(?:ps5|ps5 usb hub|ps5 ssd)$/i.test(q.trim())) {
    const hub={...offer(5),
      merchant:'Amazon Saudi',providerMarket:'amazon-sa',
      title:'Mcbazel PS5 Console Hub USB2.0 5 Ports, High Speed Multiport Expansion Hub Data Transfer USB C Fast Charging Hub for PS5',
      productPrice:34.79,currency:'SAR',
      sourceUrl:'https://www.amazon.sa/-/en/Mcbazel-Multiport-Expansion-Transfer-Charging/dp/B0B1Q2NQGL/ref=sr_1_74',
      specs:{modelNumber:'B0B1Q2NQGL'}};
    const consoleOffer={...offer(6),merchant:'Jarir',providerMarket:'jarir-sa',
      title:'Sony PS5 Slim Disc Console 1TB',productPrice:2749,
      sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668744.html',
      specs:{brand:'Sony',modelNumber:'CFI2116A01Y',storage:'1TB'}};
    // Adversarial package composition; synthetic merchant, not a claimed live
    // Jarir product. Both offers share a console chassis SKU but not contents.
    const packaged={...consoleOffer,merchant:'Fixture Package Merchant',
      title:'Sony PS5 Slim Disc Console with USB Hub 1TB',productPrice:2899,
      sourceUrl:'https://www.example.org/ps5-console-with-included-hub'};
    // E1 merchant evidence from the Sharaf DG UAE page, retrieved in Oct 2026.
    // Page snapshot showed AED 2,599 sold by Gamez Geek LLC FZ, Item S200794860;
    // this isolated replay is NOT a claim about current stock/price.
    const sharafActual={
      merchant:'Gamez Geek LLC FZ',merchantCountryCode:'AE',
      merchantCountryNameAr:'الإمارات',providerMarket:'sharafdg-ae',
      title:'Sony PlayStation 5 Digital Console White + PS5 PULSE 3D wireless headset + PS5 Dual Sense Wireless Controller',
      productPrice:2599,currency:'AED',condition:'new',
      sourceUrl:'https://uae.sharafdg.com/product/sony-playstation-5-digital-console-ps5-pulse-3d-wireless-headset-ps5-dual-sense-wireless-controller/',
      image:null,availability:'unknown',dataKind:'live',
      specs:{brand:'Sony',deviceType:'Home Console',modelNumber:'PlayStation PS5',color:'White',merchantItemNumber:'S200794860'},
    };
    // E1: actual Amazon Saudi WD_BLACK PS5-compatible SN850 SSD observed
    // in raw candidate SSE on 2026-10-17. SAR 799 is a historical observation,
    // not a newly verified merchant price. ASIN is NOT a manufacturer SKU.
    const wdBlackSsd={
      merchant:'Amazon Saudi',merchantCountryCode:'SA',merchantCountryNameAr:'السعودية',
      providerMarket:'amazon-sa',title:'WD_BLACK 1TB SN850 NVMe SSD for PS5 Consoles Solid State Drive with Heatsink',
      productPrice:799,currency:'SAR',condition:'new',
      sourceIdentifier:'B0B4SQB1HY',image:null,availability:'unknown',
      sourceUrl:'https://www.amazon.sa/-/en/WD_BLACK-SN850-Consoles-Solid-Heatsink/dp/B0B4SQB1HY/ref=sr_1_140',
    };
    // E1 independently inspected Noon Saudi product pages. These products
    // contain cooling hardware, NOT an SSD, despite SSD/NVMe compatibility nouns.
    // Prices are documented indexed-page observations, not live quotes.
    const noonHeatsink={
      merchant:'GLOTRENDS',merchantCountryCode:'SA',providerMarket:'noon-sa',
      title:'Heatsink for PS5 NVMe SSD',productPrice:64,currency:'SAR',
      sourceIdentifier:'Z78E6BD03E487FC7156B1Z',condition:'new',
      sourceUrl:'https://www.noon.com/saudi-en/heatsink-for-ps5-nvme-ssd/Z78E6BD03E487FC7156B1Z/p/',
    };
    const noonExcefore={
      merchant:'ZARIO',merchantCountryCode:'SA',providerMarket:'noon-sa',
      title:'M.2 Heatsink for PS5, NVMe SSD Aluminum Heatsink with 4 Thermal Pads for Playstation 5 Internal M.2 Gen4 NVME PCIE 4.0 SSD with Graphene and Silicone Thermal Pads',
      productPrice:156,currency:'SAR',condition:'new',
      sourceIdentifier:'Z93526034EEDFE197439CZ',
      sourceUrl:'https://www.noon.com/saudi-en/m-2-heatsink-for-ps5-nvme-ssd-aluminum-heatsink-with-4-thermal-pads-for-playstation-5-internal-m-2-gen4-nvme-pcie-4-0-ssd-with-graphene-and-silicone-thermal-pads/Z93526034EEDFE197439CZ/p/',
    };
    // E1 direct Jarir product pages independently inspected 2026-10-17.
    // Item 677771 is a complete PS5 bundled with DualSense, not a separate
    // controller. Item 668751 is a distinct bare console retail package.
    // CFI manufacturer references come from public PDP specifications,
    // not a claimed Constructor API raw response. Prices are page observations.
    const jarirDigBase={
      merchant:'Jarir',providerMarket:'jarir-sa',merchantCountryCode:'SA',
      title:'Sony PlayStation 5 Slim (DIG) 825 GB SSD, White',
      productPrice:2529,currency:'SAR',condition:'new',
      sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html',
      sourceMeta:{productId:'668751',parsedFrom:'public-jarir-product-page'},
      specs:{brand:'Sony',modelNumber:'CFI2116B01Y',storage:'825 GB SSD'},
    };
    const jarirDigBundle={
      merchant:'Jarir',providerMarket:'jarir-sa',merchantCountryCode:'SA',
      title:'Sony PlayStation 5 Slim (DIG) 825 GB SSD, Bundle with DualSense Wireless Controller, White',
      productPrice:2829,currency:'SAR',condition:'new',
      sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-dig-gaming-consoles-and-handheld-677771.html',
      sourceMeta:{productId:'677771',parsedFrom:'public-jarir-product-page'},
      specs:{brand:'Sony',modelNumber:'CFI2116BCFIZC',storage:'825 GB SSD'},
    };
    const raw=[hub,consoleOffer,packaged,sharafActual,wdBlackSsd,
      noonHeatsink,noonExcefore,jarirDigBase,jarirDigBundle];
    const offers=raw.map(o=>({...o,...assessOfferMatch(q,o)}));
    return {offers,errors:[],providers:[],
      coverage:{partial:false,deadlineExceeded:false,providersPending:0},nextCursor:null};
  }
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
  async function capturePendingScreenshot(tab,path){
    // Playwright screenshots wait on document.fonts.ready, which can remain
    // unsettled while the deliberately stalled image holds the load event.
    const client=await tab.context().newCDPSession(tab);
    try{
      const screenshot=await client.send('Page.captureScreenshot',
        {format:'png',fromSurface:true,captureBeyondViewport:false});
      writeFileSync(path,Buffer.from(screenshot.data,'base64'));
      summary.screenshotPaths.push(path);
    }finally{await client.detach();}
  }
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
  await detailPending.waitForURL(url=>url.pathname.endsWith('/product.html')&&url.searchParams.has('source'),{waitUntil:'domcontentloaded',timeout:12000});
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
  await capturePendingScreenshot(detailPending,'browser-artifacts/fixture-detail-image-pending-desktop.png');
  await detailPending.setViewportSize({width:390,height:844});
  const detailMobile=await detailPending.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    visible:!document.querySelector('.product-media .media-fallback').hidden}));
  assertCheck('pending_detail_mobile_no_overflow',
    detailMobile.scrollWidth<=detailMobile.viewport+4&&detailMobile.visible,detailMobile);
  await capturePendingScreenshot(detailPending,'browser-artifacts/fixture-detail-image-pending-mobile.png');
  releaseDetailImage();
  await detailPending.waitForFunction(()=>{
    const img=document.querySelector('.product-media img');
    return img.complete&&img.naturalWidth===0&&
      getComputedStyle(img).display==='none'&&
      !document.querySelector('.product-media .media-fallback').hidden;
  },null,{timeout:12000});
  assertCheck('detail_image_failure_shows_fallback',
    (await detailPending.locator('.product-media .media-fallback').textContent()).includes('تعذر تحميل'));

  // E1 image race: same-origin inline product image may already be complete
  // before the search card load callback finishes on re-render.
  const loadedCards=await navigate('fixture-detail-loaded');
  await loadedCards.locator('.match-card-image img').first().waitFor();
  await loadedCards.waitForFunction(()=>{
    const image=document.querySelector('.match-card-image img');
    return image?.complete&&image.naturalWidth>0;
  },null,{timeout:12000});
  const cacheLoadedState=await loadedCards.evaluate(()=>{
    const image=document.querySelector('.match-card-image img');
    const fallback=image?.nextElementSibling;
    return {loaded:!!image?.complete&&image.naturalWidth>0,
      fallbackDisplay:fallback?getComputedStyle(fallback).display:null};
  });
  assertCheck('loaded_customer_search_card_never_keeps_placeholder_visible',
    cacheLoadedState.loaded&&cacheLoadedState.fallbackDisplay==='none',cacheLoadedState);
  const detailLoaded=await navigate('fixture-detail-loaded');
  await detailLoaded.locator('#results .match-result-card').first().click();
  await detailLoaded.locator('.selected-comparison[open] .product-detail-btn').first().click();
  await detailLoaded.waitForURL(url=>url.pathname.endsWith('/product.html')&&url.searchParams.has('source'),{waitUntil:'domcontentloaded',timeout:12000});
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
  // Assert both the actual matching function and the customer-visible UI.
  for (const [q,label] of [['PS5 DualSense Bundle','en'],['بلايستيشن 5 مع يد إضافية','ar']]) {
    const raw=searchPayload(q,null).offers.filter(o=>o.exactMatch);
    assertCheck('v1517_exact_source_controller_bundle_'+label,
      raw.length===1&&raw[0].sourceMeta.productId==='677770'&&raw[0].productPrice===3049,
      raw.map(o=>({sku:o.sourceMeta?.productId,title:o.title})));
    const bundleTab=await navigate(q);
    await bundleTab.locator('#results .match-result-card').first().waitFor({timeout:15000});
    const visible=await bundleTab.locator('#results .match-card-copy strong').allTextContents();
    assertCheck('v1517_browser_only_real_controller_console_'+label,
      visible.length===1&&!visible.some(x=>/fortnite|fornite|charging/i.test(x)),
      {visible,query:q});
    await bundleTab.screenshot({path:'browser-artifacts/v1517-dualsense-'+label+'-desktop.png',fullPage:true});
    await bundleTab.setViewportSize({width:390,height:844});
    const mobile=await bundleTab.evaluate(()=>({width:innerWidth,
      scrollWidth:document.documentElement.scrollWidth,
      cards:document.querySelectorAll('#results .match-result-card').length}));
    assertCheck('v1517_bundle_390px_mobile_'+label,
      mobile.cards===1&&mobile.scrollWidth<=mobile.width+4,mobile);
    await bundleTab.screenshot({path:'browser-artifacts/v1517-dualsense-'+label+'-mobile.png',fullPage:true});
    await bundleTab.close();
  }
  // E1 recovered product identity across retailer package SKUs in the
  // real client markup, independent of live/storefront availability.
  const recovered=searchPayload('PS5 Slim',null).offers;
  const recoveredSkus=new Set(recovered.map(o=>o.sourceMeta?.productId));
  assertCheck('v1518_recovered_jarir_source_SKUs_distinct',
    recovered.length===4&&recoveredSkus.size===4&&
    ['627671','627678','670688','677770'].every(s=>recoveredSkus.has(s))&&
    !recoveredSkus.has('677771')&&recovered.every(o=>o.exactMatch===true),
    recovered.map(o=>({sku:o.sourceMeta?.productId,exact:o.exactMatch,price:o.productPrice})));
  const recoveryTab=await navigate('PS5 Slim');
  await recoveryTab.locator('#results .match-result-card').first().waitFor({timeout:15000});
  const recoveredTitles=await recoveryTab.locator('#results .match-card-copy strong').allTextContents();
  assertCheck('v1518_recovered_jarir_customer_product_cards',
    recoveredTitles.length===4&&
    recoveredTitles.some(s=>/نسخة رقمية/i.test(s))&&
    recoveredTitles.some(s=>/نسخة الأقراص/i.test(s))&&
    recoveredTitles.some(s=>/Fortnite/i.test(s))&&
    recoveredTitles.some(s=>/DualSense/i.test(s))&&
    !recoveredTitles.some(s=>/حزمة مع إضافات/i.test(s)),
    recoveredTitles);
  await recoveryTab.screenshot({path:'browser-artifacts/v1518-jarir-recovered-desktop.png',fullPage:true});
  await recoveryTab.setViewportSize({width:390,height:844});
  const recoveryMobile=await recoveryTab.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    cards:document.querySelectorAll('#results .match-result-card').length}));
  assertCheck('v1518_recovered_jarir_390px_mobile',
    recoveryMobile.cards>=3&&recoveryMobile.scrollWidth<=recoveryMobile.viewport+4,
    recoveryMobile);
  await recoveryTab.screenshot({path:'browser-artifacts/v1518-jarir-recovered-mobile.png',fullPage:true});
  await recoveryTab.close();
  const ps5IdentityTab=await navigate('PS5');
  await ps5IdentityTab.locator('#results .match-result-card').first().waitFor();
  const consoleOnly=await ps5IdentityTab.locator('#results .match-card-copy strong').allTextContents();
  const hubFixture=searchPayload('PS5',null).offers.find(o=>o.merchant==='Amazon Saudi');
  assertCheck('real_mcbazel_sse_is_accessory_not_console',
    hubFixture?.productKind==='accessory'&&hubFixture?.exactMatch===false&&
    hubFixture?.productPrice===34.79&&hubFixture?.specs?.modelNumber==='B0B1Q2NQGL',
    {title:hubFixture?.title,kind:hubFixture?.productKind,exact:hubFixture?.exactMatch});
  assertCheck('actual_console_remains_visible_while_usb_hub_excluded',
    consoleOnly.length===5&&consoleOnly.every(x=>/PS5|PlayStation 5/i.test(x))&&
    !consoleOnly.some(x=>/Mcbazel|USB Hub/i.test(x)),consoleOnly);
  const exactPS5=searchPayload('PS5',null).offers.filter(o=>o.exactMatch===true);
  const standalone=exactPS5.find(o=>o.merchant==='Jarir');
  const includedHub=exactPS5.find(o=>o.merchant==='Fixture Package Merchant');
  assertCheck('included_hub_console_and_standalone_keep_distinct_product_cards',
    exactPS5.length===5&&consoleOnly.length===5&&
    describeProduct(includedHub).isBundle===true&&
    describeProduct(standalone).isBundle===false&&
    includedHub.specs.modelNumber===standalone.specs.modelNumber,
    {exactPS5:exactPS5.map(o=>({title:o.title,merchant:o.merchant,exact:o.exactMatch})),consoleOnly});
  const jarirE1=exactPS5.filter(o=>['668751','677771'].includes(o.sourceMeta?.productId));
  assertCheck('E1_jarir_real_bare_and_dualsense_bundle_raw_sse_stay_consoles',
    jarirE1.length===2&&jarirE1.every(o=>o.productKind==='console'&&o.exactMatch===true&&
      o.currency==='SAR'&&o.sourceUrl.includes(o.sourceMeta.productId))&&
    jarirE1.find(o=>o.sourceMeta.productId==='677771')?.productPrice===2829&&
    jarirE1.find(o=>o.sourceMeta.productId==='668751')?.productPrice===2529,
    jarirE1.map(o=>({title:o.title,kind:o.productKind,price:o.productPrice,code:o.specs.modelNumber})));
  assertCheck('E1_jarir_bare_and_additional_controller_distinct_customer_cards',
    consoleOnly.length===5&&new Set(jarirE1.map(o=>o.specs.modelNumber)).size===2&&
    consoleOnly.some(t=>t.includes('حزمة'))&&
    describeProduct(jarirE1.find(o=>o.sourceMeta.productId==='677771')).isBundle===true&&
    describeProduct(jarirE1.find(o=>o.sourceMeta.productId==='668751')).isBundle===false,
    {visible:consoleOnly,jarirE1:jarirE1.map(o=>o.title)});
  await ps5IdentityTab.screenshot({path:'browser-artifacts/fixture-ps5-jarir-real-dualsense-package-desktop.png',fullPage:true});
  const sharaf=searchPayload('PS5',null).offers.find(o=>o.providerMarket==='sharafdg-ae');
  assertCheck('real_sharaf_uae_bundle_kept_as_console_in_customer_results',
    sharaf?.exactMatch===true&&sharaf?.productKind==='console'&&
    describeProduct(sharaf).isBundle===true&&sharaf?.productPrice===2599&&
    sharaf?.currency==='AED'&&
    consoleOnly.some(t=>t.includes('نسخة رقمية')&&t.includes('حزمة'))&&
    sharaf?.sourceUrl?.includes('sharafdg.com/product/'),
    {kind:sharaf?.productKind,exact:sharaf?.exactMatch,title:sharaf?.title,displayed:consoleOnly});
  // Historical Sharaf DG UAE fixture uses AED 2599. It must remain a console
  // result but must NOT be rendered as SAR 2599 without an evidenced FX conversion.
  const rawForeignAmount=new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(2599);
  const sarMislabel=rawForeignAmount+' ر.س';
  const cardText=await ps5IdentityTab.locator('#results .match-result-card').allTextContents();
  assertCheck('v181_unconverted_AED_never_appears_as_SAR_card_price',
    !cardText.some(text=>text.includes(sarMislabel)),
    {foreignCurrency:'AED',sourcePrice:2599,incorrectSARLabel:sarMislabel});
  const uaeIndex=consoleOnly.findIndex(title=>title.includes('نسخة رقمية')&&title.includes('حزمة'));
  if(uaeIndex>=0){
    await ps5IdentityTab.locator('#results .match-result-card').nth(uaeIndex).click();
    const warning=await ps5IdentityTab.locator('#results .merchant-warnings').allTextContents();
    assertCheck('v181_unconverted_AED_comparison_exposes_conversion_uncertainty',
      warning.some(text=>text.includes('سعر المصدر بعملة أجنبية')),
      {warnings:warning});
  }else{
    assertCheck('v181_unconverted_AED_comparison_exposes_conversion_uncertainty',false,
      'foreign console bundle card not found in controlled fixture');
  }
  await ps5IdentityTab.setViewportSize({width:390,height:844});
  const sharafMobile=await ps5IdentityTab.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assertCheck('real_sharaf_bundle_mobile_no_overflow',sharafMobile.scrollWidth<=sharafMobile.viewport+4,sharafMobile);
  await ps5IdentityTab.screenshot({path:'browser-artifacts/fixture-ps5-sharaf-bundle-mobile.png',fullPage:true});
  await ps5IdentityTab.screenshot({path:'browser-artifacts/fixture-ps5-console-vs-usb-hub.png',fullPage:true});
  const wdSse=searchPayload('PS5',null).offers.find(o=>o.sourceIdentifier==='B0B4SQB1HY');
  assertCheck('real_wd_black_ssd_raw_sse_is_not_exact_console',
    wdSse?.productKind==='accessory'&&wdSse?.exactMatch===false&&
    wdSse?.matchReason!=='يطابق مواصفات بحثك'&&
    wdSse?.currency==='SAR'&&wdSse?.productPrice===799&&
    wdSse?.sourceUrl?.includes('/dp/B0B4SQB1HY/'),
    {kind:wdSse?.productKind,exact:wdSse?.exactMatch,reason:wdSse?.matchReason,
      price:wdSse?.productPrice,source:wdSse?.sourceUrl});
  const jarirSsdQuery=searchPayload('PS5 SSD',null).offers.filter(o=>['668751','677771'].includes(o.sourceMeta?.productId));
  assertCheck('E1_jarir_console_and_bundle_not_false_ssd_shop_items',
    jarirSsdQuery.length===2&&jarirSsdQuery.every(o=>o.productKind==='console'&&o.exactMatch===false),
    jarirSsdQuery.map(o=>({title:o.title,kind:o.productKind,exact:o.exactMatch})));
  assertCheck('real_wd_black_ssd_absent_from_ps5_console_cards',
    consoleOnly.length===5&&!consoleOnly.some(x=>/WD_BLACK|SN850|NVMe/i.test(x)),consoleOnly);
  const noonSsds=searchPayload('PS5 SSD',null).offers
    .filter(o=>o.providerMarket==='noon-sa');
  assertCheck('E1_noon_heatsinks_not_exact_ssd_in_raw_sse',
    noonSsds.length===2&&noonSsds.every(o=>o.productKind==='accessory'&&
      o.exactMatch===false&&o.matchReason!=='يطابق مواصفات بحثك'&&
      o.currency==='SAR'&&o.sourceUrl.includes(o.sourceIdentifier)),
    noonSsds.map(o=>({title:o.title,exact:o.exactMatch,reason:o.matchReason,price:o.productPrice})));
  const ssdShoppingTab=await navigate('PS5 SSD');
  await ssdShoppingTab.locator('#results .match-result-card').first().waitFor();
  const ssdResults=await ssdShoppingTab.locator('#results .match-card-copy strong').allTextContents();
  const ssdExact=searchPayload('PS5 SSD',null).offers.find(o=>o.sourceIdentifier==='B0B4SQB1HY');
  const ssdCardText=await ssdShoppingTab.locator('#results .match-result-card').first().innerText();
  assertCheck('real_noon_heatsinks_excluded_from_complete_ssd_cards',
    ssdResults.length===1&&!ssdResults.some(s=>/glotrends|excefore|heatsink for ps5/i.test(s)),
    {ssdResults});
  assertCheck('explicit_ps5_ssd_search_preserves_real_wd_black_offer',
    ssdExact?.productKind==='accessory'&&ssdExact?.exactMatch===true&&
    ssdResults.some(x=>/WD_BLACK|SN850|SSD/i.test(x))&&/799|٧٩٩|۷۹۹/u.test(ssdCardText),
    {results:ssdResults,cardText:ssdCardText.slice(0,450),exact:ssdExact?.exactMatch});
  await ssdShoppingTab.screenshot({path:'browser-artifacts/fixture-ps5-ssd-desktop.png',fullPage:true});
  await ssdShoppingTab.setViewportSize({width:390,height:844});
  const ssdMobile=await ssdShoppingTab.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assertCheck('wd_black_ssd_mobile_no_horizontal_overflow',
    ssdMobile.scrollWidth<=ssdMobile.viewport+4,ssdMobile);
  await ssdShoppingTab.screenshot({path:'browser-artifacts/fixture-ps5-ssd-mobile.png',fullPage:true});
  const hubShoppingTab=await navigate('PS5 USB hub');
  await hubShoppingTab.locator('#results .match-result-card').first().waitFor();
  const hubResults=await hubShoppingTab.locator('#results .match-card-copy strong').allTextContents();
  const hubAccessory=searchPayload('PS5 USB hub',null).offers.find(o=>o.merchant==='Amazon Saudi');
  assertCheck('usb_hub_shop_search_preserves_real_mcbazel_offer',
    hubAccessory?.productKind==='accessory'&&hubAccessory?.exactMatch===true&&
    hubResults.some(x=>/Mcbazel/i.test(x)),{hubResults,exact:hubAccessory?.exactMatch});
  await hubShoppingTab.setViewportSize({width:390,height:844});
  const hubMobile=await hubShoppingTab.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assertCheck('usb_hub_mobile_layout_no_overflow',hubMobile.scrollWidth<=hubMobile.viewport+4,hubMobile);
  await hubShoppingTab.screenshot({path:'browser-artifacts/fixture-ps5-usb-hub-mobile.png',fullPage:true});
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
