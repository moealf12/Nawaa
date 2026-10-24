// Real Chromium interactions against the exact PR website with fixed SSE
// fixtures. No merchant/network searches: every search API call is intercepted.
// Exercises actual browser DOM, event listeners, card expansion, pagination
// gestures, filters, customer navigation and error/empty displays.
import {chromium} from 'playwright';
import fc from 'fast-check';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import net from 'node:net';
import {assessOfferMatch,describeProduct} from '../src/search-query.mjs';
import {groupComparableOffers} from '../src/search-core.mjs';

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
  if(q.includes('fixture-performance-')){
    const n=Math.min(60,Number(q.match(/fixture-performance-(\d+)-/)?.[1]||24));
    return {offers:Array.from({length:n},(_,i)=>({...offer(i+1),image:null})),
      errors:[],providers:[],coverage:{partial:false,deadlineExceeded:false,providersPending:0},nextCursor:null};
  }
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
  if(q.includes('fixture-selected-placeholder') || q.includes('fixture-selected-valid')) {
    const clean=q.includes('fixture-selected-valid');
    return {
      offers:[{...offer(5),specs:{
        brand:'HP',deviceType:'Laptop',modelNumber:'HP-LAP-05',
        storage:'512 GB',color:'Silver',
        ram:clean?'16 GB':'No',processor:clean?'Intel Core i5':'undefined',
        regionVersion:clean?'Middle East':'No',
        sim:clean?'Dual eSIM':'N/A',waterproof:false,
      }}],
      errors:[],providers:[],coverage:{partial:false,deadlineExceeded:false,providersPending:0},
      nextCursor:null
    };
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
      const mode=q.match(/fixture-performance-\d+-(single|progress|duplicate|price|currency|condition|availability|source|coverage|remove|merchant|variant|cursor|image)/)?.[1]||'single';
      const mutations=new Set(['price','currency','condition','availability','source',
        'coverage','remove','merchant','variant','cursor','image']);
      const mutateOffer=offer=>{
        if(mode==='price')return {...offer,productPrice:offer.productPrice+71};
        if(mode==='currency')return {...offer,currency:'AED'};
        if(mode==='condition')return {...offer,condition:'refurbished'};
        if(mode==='availability')return {...offer,availability:'out_of_stock'};
        if(mode==='source')return {...offer,sourceUrl:offer.sourceUrl+'?variant=changed'};
        if(mode==='merchant')return {...offer,merchant:'Fixture Mutated Seller'};
        if(mode==='variant')return {...offer,specs:{...offer.specs,modelNumber:'HP-LAP-DISTINCT-01',ram:'16GB'}};
        if(mode==='image')return {...offer,image:'https://nawaa-fixture.invalid/changed.jpg'};
        return offer;
      };
      const mutated=mutations.has(mode)?{
        ...payload,
        offers:mode==='remove'?payload.offers.slice(1):
          payload.offers.map((o,i)=>i===0?mutateOffer(o):o),
        coverage:mode==='coverage'?{...payload.coverage,partial:true}:payload.coverage,
        nextCursor:mode==='cursor'?'signed-test-depth-1':payload.nextCursor
      }:null;
      const frames=mode==='progress'?[{...payload,offers:payload.offers.slice(0,5)},payload]:
        mode==='duplicate'?[payload,payload]:
        mutated?[payload,mutated]:[payload];
      const body=frames.map(x=>'event: snapshot\n'+'data: '+JSON.stringify(x)+'\n\n').join('')+
        'event: done\n'+'data: {}\n\n';
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
  // v21.57: exercise the unpatched production search module, not a simulated
  // standalone metrics calculation. A captured fixture screenshot is independent
  // browser rendering evidence, NOT real-merchant provenance or compositor proof.
  const firstCardQuery='HP laptop fixture-performance-6-single';
  const firstCardPage=await context.newPage();
  firstCardPage.setDefaultTimeout(12000);
  await firstCardPage.addInitScript(()=>{window.NAWAA_DIAGNOSTICS=true;});
  try{
    await firstCardPage.goto(base+'/search.html?q='+encodeURIComponent(firstCardQuery),
      {waitUntil:'domcontentloaded',timeout:20000});
    await firstCardPage.waitForFunction(()=>Boolean(
      window.__nawaaFirstOfferDiagnostics?.firstCard?.secondFrameMs),null,{timeout:14000});
    const observed=await firstCardPage.evaluate(()=>window.__nawaaFirstOfferDiagnostics);
    const sourceRecord=searchPayload(firstCardQuery,null).offers.find(
      o=>o.sourceUrl===observed.firstCard.sourceUrl);
    assertCheck('v2157_first_card_real_dom_matches_selected_fixture_offer',
      Boolean(sourceRecord)&&observed.firstCard.domMatchesSelectedOffer&&
      observed.firstCard.structurallyValid&&
      observed.firstCard.productPrice===sourceRecord.productPrice&&
      observed.firstCard.merchant===sourceRecord.merchant&&
      observed.firstCard.modelNumber===sourceRecord.specs.modelNumber&&
      observed.firstCard.currency===sourceRecord.currency,observed.firstCard);
    assertCheck('v2157_timeline_request_scoping_and_monotonic_observability',
      observed.requestId>0&&observed.milestones.T0<=observed.milestones.T1&&
      observed.milestones.T1<=observed.milestones.T3&&
      observed.milestones.T3<=observed.milestones.T4&&
      observed.firstCard.domCommitMs>=observed.elapsedMs.T4&&
      observed.firstCard.frameMs>=observed.firstCard.domCommitMs&&
      observed.firstCard.secondFrameMs>=observed.firstCard.frameMs,observed);
    assertCheck('v2157_fixture_does_not_falsely_certify_merchant_or_compositor',
      observed.firstCard.ownership.state==='CONSISTENT_BUT_UNVERIFIED'&&
      observed.firstCard.ownership.eligible===false&&
      observed.milestones.T5===undefined&&observed.milestones.T8===undefined&&
      observed.productionPaintCertified===false&&
      observed.firstCard.screenshotPaintEvidence===false,observed);
    const firstCardLocator=firstCardPage.locator('#results .match-result-card').first();
    await firstCardLocator.scrollIntoViewIfNeeded();
    const visible=await firstCardLocator.evaluate(node=>{
      const r=node.getBoundingClientRect();
      const p=document.elementFromPoint(
        Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),
        Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)));
      return {w:r.width,h:r.height,inViewport:r.top<innerHeight&&r.bottom>0,
        hit:Boolean(p&&node.contains(p)),text:node.querySelector('strong')?.textContent};
    });
    const cdp=await context.newCDPSession(firstCardPage);
    let png;
    try{
      const capture=await cdp.send('Page.captureScreenshot',
        {format:'png',fromSurface:true,captureBeyondViewport:false});
      png=Buffer.from(capture.data,'base64');
    }finally{await cdp.detach();}
    const screenshotFile='browser-artifacts/fixture-first-card-v2157.png';
    writeFileSync(screenshotFile,png);
    summary.screenshotPaths.push(screenshotFile);
    const captureOk=png.length>2000&&png.subarray(1,4).toString()==='PNG';
    assertCheck('v2157_independently_captured_first_card_fixture_frame',
      visible.w>0&&visible.h>0&&visible.inViewport&&visible.hit&&
      captureOk&&visible.text===observed.firstCard.domTitle,
      {visible,pngBytes:png.length});
    const report={scope:'intercepted_sse_real_browser_unmodified_customer_module',
      query:firstCardQuery,requestId:observed.requestId,
      firstCard:observed.firstCard,timeline:observed.elapsedMs,
      independentBrowserScreenshot:captureOk,
      merchantSourceOwnershipCertified:false,
      compositorPaintCertified:false,productionP95Certified:false,
      screenshotFile};
    writeFileSync('browser-artifacts/fixture-first-card-v2157.json',
      JSON.stringify(report,null,2));
    console.log('NAWAA_V2157_FIRST_CARD '+JSON.stringify(report));
  }finally{await firstCardPage.close();}

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
  // P0-A combined PR #111/#112: verify actual selected-variant and canonical
  // presentation on the live candidate UI, not merely helper output.
  const placeholderTab=await navigate('fixture-selected-placeholder');
  await placeholderTab.locator('#results .match-result-card').first().waitFor();
  await placeholderTab.locator('#results .match-result-card').first().click();
  await placeholderTab.locator('.selected-comparison[open] .product-configurator').waitFor();
  const badBadges=await placeholderTab.locator('.config-summary').innerText();
  const rawCanonical=await placeholderTab.locator('.canonical-grid').evaluate(el=>
    [...el.querySelectorAll('.canonical-spec')].map(node=>({
      label:node.querySelector('small')?.textContent?.trim(),
      value:node.querySelector('b')?.textContent?.trim()
    })));
  const profileValues=Object.fromEntries(rawCanonical.map(({label,value})=>[label,value]));
  const invalidFieldValues=new Set(['no','n/a','undefined','false','unknown']);
  assertCheck('v2116_no_placeholder_selected_region_or_sim',
    ![...invalidFieldValues].some(value=>badBadges.toLowerCase().split(/[^a-z/]+/).includes(value)),
    {badBadges});
  assertCheck('v2116_no_placeholder_canonical_attributes',
    !Object.values(profileValues).some(v=>invalidFieldValues.has(String(v).trim().toLowerCase())) &&
    !('الذاكرة' in profileValues) && !('المعالج' in profileValues) &&
    !('نسخة المنطقة' in profileValues) && !('الشريحة' in profileValues),
    {profileValues});
  assertCheck('v2116_legitimate_negative_waterproof_preserved',
    profileValues['مقاومة الماء']==='لا',{profileValues});
  const validTab=await navigate('fixture-selected-valid');
  await validTab.locator('#results .match-result-card').first().waitFor();
  await validTab.locator('#results .match-result-card').first().click();
  await validTab.locator('.selected-comparison[open] .product-configurator').waitFor();
  const goodBadges=await validTab.locator('.config-summary').innerText();
  await validTab.locator('.selected-comparison[open] .canonical-section summary').click();
  const goodProfile=await validTab.locator('.selected-comparison[open] .canonical-grid').innerText();
  assertCheck('v2116_selected_valid_region_sim_retained',
    goodBadges.includes('Middle East') && goodBadges.includes('Dual eSIM'),{goodBadges});
  assertCheck('v2116_canonical_valid_ram_and_processor_retained',
    goodProfile.includes('16 GB') && goodProfile.includes('Intel Core i5'),{goodProfile});
  const selectedMobile=await validTab.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assertCheck('v2116_selected_variant_mobile_no_overflow',
    selectedMobile.scrollWidth<=selectedMobile.viewport+4,selectedMobile);
  // Preserve the original test's global search-request accounting below.
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
  // Merchants may use different manufacturer SKUs for the SAME phone variant.
  // The buyer must see one card and a genuine cross-merchant comparison.
  const duplicated=await navigate('fixture-iphone-models');
  await duplicated.locator('#results .match-result-card').first().waitFor();
  const duplicateCards=duplicated.locator('#results .match-result-card');
  const duplicateCount=await duplicateCards.count();
  const titles=await duplicated.locator('#results .match-card-copy strong').allTextContents();
  const coverage=await duplicated.locator('#results .card-coverage').first().textContent();
  assertCheck('identical_phone_configuration_groups_across_merchant_skus',duplicateCount===1,
    {duplicateCount,titles});
  assertCheck('phone_card_retains_both_merchant_offers',
    coverage.includes('عرضان') && coverage.includes('متجران'),{coverage});
  await duplicateCards.first().click();
  const comparisonRows=await duplicated.locator('.selected-comparison[open] .merchant-comparison .merchant-row').count();
  const skuSelectors=await duplicated.locator('[data-dimension="skuKey"]').count();
  const note=await duplicated.locator('.selected-comparison[open] .model-identity-note').textContent();
  assertCheck('phone_comparison_independent_of_sku_with_visible_caveat',
    comparisonRows===2 && skuSelectors===0 && note.includes('دون اشتراط رقم SKU'),
    {comparisonRows,skuSelectors,note});
  await duplicated.screenshot({path:'browser-artifacts/fixture-iphone-cross-merchant-comparison.png',fullPage:true});
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
  // Select by observed merchant identity, NOT by a similar-looking bundle
  // title: several real fixtures can contain "Digital" + "bundle" wording.
  let uaeWarnings=[],uaeMerchantFound=false;
  for(let cardIndex=0;cardIndex<consoleOnly.length;cardIndex++){
    await ps5IdentityTab.locator('#results .match-result-card').nth(cardIndex).click();
    const merchants=await ps5IdentityTab.locator('#results .merchant-row .merchant-main strong').allTextContents();
    if(merchants.some(name=>name.includes('Gamez Geek LLC FZ'))){
      uaeMerchantFound=true;
      uaeWarnings=await ps5IdentityTab.locator('#results .merchant-warnings').allTextContents();
      break;
    }
  }
  assertCheck('v181_unconverted_AED_comparison_exposes_conversion_uncertainty',
    uaeMerchantFound&&uaeWarnings.some(text=>text.includes('سعر المصدر بعملة أجنبية')),
    {merchantFound:uaeMerchantFound,warnings:uaeWarnings});
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

  // v21.52: fixed-offer Chromium experiments, using the existing intercepted
  // SSE endpoint. Diagnostics do not certify real source ownership or paint.
  const experiments=[
    ['en_control','HP laptop fixture-performance-24-single',false],
    ['en_observed','HP laptop fixture-performance-24-single',true],
    ['ar_observed','لابتوب اتش بي fixture-performance-24-single',true],
    ['progressive','HP laptop fixture-performance-24-progress',true],
    ['duplicate','HP laptop fixture-performance-24-duplicate',true],
    ['small','HP laptop fixture-performance-6-single',true],
    ['large','HP laptop fixture-performance-48-single',true],
  ];

  // v21.53 test-only source transform. Production source is read but NEVER
  // edited: the local Chromium route serves this instrumented test copy.
  let patchedSource=readFileSync(new URL('../src/search-page.mjs',import.meta.url),'utf8');
  const patch=(from,to,name)=>{
    const count=patchedSource.split(from).length-1;
    if(count!==1)throw Error('critical_path_patch_anchor_'+name+'_'+count);
    patchedSource=patchedSource.replace(from,to);
  };
  const helper=[
    'const __criticalSpan=(phase,fn)=>{',
    '  const start=performance.now();',
    '  try{return fn();}finally{',
    '    if(Array.isArray(window.__criticalPath)&&window.__criticalPath.length<150)',
    '      window.__criticalPath.push({phase,ms:Math.round((performance.now()-start)*1000)/1000});',
    '  }',
    '};',
    'const $ = (selector) => document.querySelector(selector);'
  ].join('\n');
  patch('const $ = (selector) => document.querySelector(selector);',helper,'helper');
  const wrappers=[
    ['  const groups = groupComparableOffers(offers, "lowest");',
     '  const groups = __criticalSpan("history.group",()=>groupComparableOffers(offers, "lowest"));','history_group'],
    ['  const ranked = rankOffers(filteredOffers, state.mode);',
     '  const ranked = __criticalSpan("render.rank",()=>rankOffers(filteredOffers, state.mode));','render_rank'],
    ['  const summary = summarizeOffers(product.offers);',
     '  const summary = __criticalSpan("render.summary",()=>summarizeOffers(product.offers));','render_summary'],
    ['  const groups = groupComparableOffers(filteredOffers, state.mode);',
     '  const groups = __criticalSpan("render.group",()=>groupComparableOffers(filteredOffers, state.mode));','render_group'],
    ['  const discoverySections = buildDiscoverySections(query, exactGroups);',
     '  const discoverySections = __criticalSpan("render.discovery",()=>buildDiscoverySections(query, exactGroups));','discovery'],
    ['  const selector = buildVariantSelectorState(selectorGroups, state.selectorSelection);',
     '  const selector = __criticalSpan("render.variant",()=>buildVariantSelectorState(selectorGroups, state.selectorSelection));','variant'],
    ['  const selectedIntelligence = selectedGroup ? buildOfferIntelligence(selectedGroup) : null;',
     '  const selectedIntelligence = selectedGroup ? __criticalSpan("render.intelligence",()=>buildOfferIntelligence(selectedGroup)) : null;','intelligence'],
    ['  const canonicalProfile = buildCanonicalProductProfile(selectedGroup?.offers || []);',
     '  const canonicalProfile = __criticalSpan("render.canonical",()=>buildCanonicalProductProfile(selectedGroup?.offers || []));','canonical'],
    ['                recordPriceHistory(payload.offers);',
     '                __criticalSpan("history.total",()=>recordPriceHistory(payload.offers));','history_total'],
    ['                renderProduct(liveProduct,query);',
     '                __criticalSpan("render.total",()=>renderProduct(liveProduct,query));','render_total']
  ];
  for(const [from,to,label] of wrappers)patch(from,to,label);
  const tick=String.fromCharCode(96);
  patch('  els.results.innerHTML = '+tick+'\n    <section class="result-head">',
    '  const __htmlStart=performance.now();\n  els.results.innerHTML = '+tick+'\n    <section class="result-head">','html_begin');
  patch("  els.results.querySelectorAll('.category-tab').forEach(button=>button.addEventListener('click',()=>{",
    '  if(Array.isArray(window.__criticalPath))window.__criticalPath.push({phase:"render.htmlAndDom",ms:Math.round((performance.now()-__htmlStart)*1000)/1000});\n'+
    "  els.results.querySelectorAll('.category-tab').forEach(button=>button.addEventListener('click',()=>{",'html_end');
  const signature=tab=>tab.evaluate(()=>[...document.querySelectorAll('#results .match-result-card')].map(card=>({
    key:card.dataset.groupKey||'',
    title:card.querySelector('.match-card-copy strong')?.textContent?.trim()||'',
    price:card.querySelector('.match-card-price b')?.textContent?.trim()||''
  })));
  const references=new Map();
  for(const query of [...new Set(experiments.map(x=>x[1]))]){
    const tab=await navigate(query);
    try{
      await tab.locator('#results .match-result-card').first().waitFor({timeout:12000});
      references.set(query,await signature(tab));
    }finally{await tab.close();}
  }
  await context.route(url=>url.hostname==='127.0.0.1'&&url.pathname==='/src/search-page.mjs',
    async route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',
      body:patchedSource}));
  const traces={scope:'synthetic_fixture_not_real_merchants',samples:[],
    productTruthCertified:false,compositorPaintCertified:false,p95Certified:false};
  for(let round=0;round<3;round++){
    const order=round%2?[...experiments].reverse():experiments;
    for(const [name,query,instrumented] of order){
      const tab=await context.newPage();
      await tab.addInitScript(detailed=>{
        // Each observation starts with identical client-side history state.
        // Otherwise the page's 800-point price-history store accumulates across
        // trials and confounds apparent DOM/frame differences.
        try{localStorage.removeItem('nawaa_price_history_v1');}catch{}
        const m={firstDom:null,frame:null,frame2:null,open:null,snapshot:null,
          snapshots:0,callbacks:0,longTasks:[],firstKey:null};
        window.__perfFixture=m;
        window.__criticalPath=[];
        // DOM write duration is measured through a scoped test-page instance
        // setter, not a change to the runtime implementation.
        const installDomSetter=()=>{
          const root=document.querySelector('#results');
          if(!root)return;
          const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
          Object.defineProperty(root,'innerHTML',{
            configurable:true,
            get(){return descriptor.get.call(this);},
            set(html){
              const t=performance.now();
              descriptor.set.call(this,html);
              if(typeof html==='string'&&html.includes('match-results-section')&&
                 window.__criticalPath.length<150)
                window.__criticalPath.push({phase:'render.domSet',
                  ms:Math.round((performance.now()-t)*1000)/1000});
            }
          });
        };
        if(document.readyState==='loading')
          document.addEventListener('DOMContentLoaded',installDomSetter,{once:true});
        else installDomSetter();
        const check=()=>{
          m.callbacks++;
          if(m.firstDom!==null)return;
          const card=document.querySelector('#results .match-result-card');
          if(!card)return;
          m.firstDom=performance.now();m.firstKey=card.dataset.groupKey||null;
          requestAnimationFrame(()=>{m.frame=performance.now();
            requestAnimationFrame(()=>{m.frame2=performance.now();});});
        };
        const init=()=>{
          const root=document.querySelector('#results');
          if(root){new MutationObserver(check).observe(root,{childList:true,subtree:true});check();}
        };
        if(document.readyState==='loading')
          document.addEventListener('DOMContentLoaded',init,{once:true});
        else init();
        try{new PerformanceObserver(list=>{
          for(const entry of list.getEntries())
            if(m.longTasks.length<16)m.longTasks.push(Math.round(entry.duration));
        }).observe({entryTypes:['longtask']});}catch{}
        if(detailed&&window.EventSource){
          const Native=window.EventSource;
          window.EventSource=class extends Native{
            constructor(...args){
              super(...args);m.open=performance.now();
              this.addEventListener('snapshot',e=>{
                m.snapshots++;
                try{if(m.snapshot===null&&JSON.parse(e.data)?.offers?.length)
                  m.snapshot=performance.now();}catch{}
              });
            }
          };
        }
      },instrumented);
      try{
        await tab.goto(base+'/search.html?q='+encodeURIComponent(query),
          {waitUntil:'domcontentloaded',timeout:20000});
        await tab.waitForFunction(()=>Number.isFinite(window.__perfFixture?.frame2),
          null,{timeout:12000});
        const m=await tab.evaluate(()=>{
          const x=window.__perfFixture;
          const span=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=b
            ?Math.round(100*(a-b))/100:null;
          return {firstDomMs:Math.round(x.firstDom),frameMs:Math.round(x.frame),
            domToFrameMs:span(x.frame,x.firstDom),domToSecondFrameMs:span(x.frame2,x.firstDom),
            sseToDomMs:span(x.firstDom,x.snapshot),snapshots:x.snapshots,
            callbackCount:x.callbacks,longTasks:x.longTasks,firstKey:x.firstKey,
            visibleCards:document.querySelectorAll('#results .match-result-card').length,
            phaseBudget:window.__criticalPath||[]};
        });
        const groups=groupComparableOffers(searchPayload(query,null).offers,'lowest');
        const target=groups.find(g=>g.key===m.firstKey);
        const unchanged=JSON.stringify(await signature(tab))===JSON.stringify(references.get(query));
        const result={name,round,...m,semanticParityToOriginal:unchanged,
          fixtureGroupMatched:Boolean(target?.bestOffer),
          fixtureModel:target?.bestOffer?.specs?.modelNumber||null,
          realSourceOwnershipCertified:false,paintCertified:false};
        traces.samples.push(result);
        assertCheck('perf_'+name+'_'+round,
          Number.isFinite(result.domToFrameMs)&&result.frameMs>=result.firstDomMs&&
          result.visibleCards>0&&result.fixtureGroupMatched&&result.semanticParityToOriginal&&
          result.phaseBudget.some(x=>x.phase==='history.total')&&
          result.phaseBudget.some(x=>x.phase==='render.total')&&
          result.phaseBudget.some(x=>x.phase==='render.domSet'),result);
      }finally{await tab.close();}
    }
  }
  const median=values=>{
    const v=values.filter(Number.isFinite).sort((a,b)=>a-b),i=Math.floor(v.length/2);
    return v.length%2?v[i]:(v[i-1]+v[i])/2;
  };
  traces.groups=Object.fromEntries(experiments.map(([name])=>{
    const rows=traces.samples.filter(r=>r.name===name);
    return [name,{n:rows.length,medianDomToFrameMs:median(rows.map(r=>r.domToFrameMs)),
      minDomToFrameMs:Math.min(...rows.map(r=>r.domToFrameMs)),
      maxDomToFrameMs:Math.max(...rows.map(r=>r.domToFrameMs)),
      medianDomMs:median(rows.map(r=>r.firstDomMs)),
      longTasks:rows.flatMap(r=>r.longTasks),
      phases:Object.fromEntries([...new Set(rows.flatMap(r=>r.phaseBudget.map(x=>x.phase)))].map(phase=>{
        const all=rows.flatMap(r=>r.phaseBudget.filter(x=>x.phase===phase).map(x=>x.ms));
        return [phase,{calls:all.length,medianMs:median(all),maxMs:Math.max(...all)}];
      }))}];
  }));

  // v21.54: compare original instrumented code with a test-only counterfactual
  // that skips ONLY strictly byte-equivalent successive SSE snapshot processing.
  // Full final reconciliation remains untouched in both variants.
  // This does NOT authorize a production optimizer or learner.
  const candidatePatch=(from,to,label)=>{
    const n=candidateSource.split(from).length-1;
    if(n!==1)throw Error('candidate_patch_anchor_'+label+'_'+n);
    candidateSource=candidateSource.replace(from,to);
  };
  let candidateSource=patchedSource;
  candidatePatch('              best=payload;',
    '              const __sameSnapshot=__criticalSpan("candidate.deepCompare",()=>Boolean(best) && JSON.stringify(best)===JSON.stringify(payload));\n'+
    '              if(__sameSnapshot)window.__nawaaSkippedDuplicate=(window.__nawaaSkippedDuplicate||0)+1;\n'+
    '              best=payload;','snapshot_compare');
  candidatePatch('                __criticalSpan("history.total",()=>recordPriceHistory(payload.offers));',
    '                if(!__sameSnapshot)__criticalSpan("history.total",()=>recordPriceHistory(payload.offers));','skip_history');
  candidatePatch('                __criticalSpan("render.total",()=>renderProduct(liveProduct,query));',
    '                if(!__sameSnapshot)__criticalSpan("render.total",()=>renderProduct(liveProduct,query));','skip_render');
  const counterCases=[
    ['duplicate','HP laptop fixture-performance-24-duplicate',3],
    ['progressive','HP laptop fixture-performance-24-progress',2],
    ['price','HP laptop fixture-performance-24-price',1],
    ['currency','HP laptop fixture-performance-24-currency',1],
    ['condition','HP laptop fixture-performance-24-condition',1],
    ['availability','HP laptop fixture-performance-24-availability',1],
    ['source','HP laptop fixture-performance-24-source',1],
    ['coverage','HP laptop fixture-performance-24-coverage',1],
    ['remove','HP laptop fixture-performance-24-remove',1],
    ['merchant','HP laptop fixture-performance-24-merchant',1],
    ['variant','HP laptop fixture-performance-24-variant',1],
    ['cursor','HP laptop fixture-performance-24-cursor',1],
    ['image','HP laptop fixture-performance-24-image',1],
  ];
  const counterResults={kind:'test_only_counterfactual_no_production_optimization',
    optimization:'skip byte-identical intermediate SSE snapshot computation only',
    semantics:'baseline vs candidate full result and final price history',samples:[],
    realMerchantOwnershipCertified:false,productionP95Certified:false};
  const executeCounter=async(query,candidate)=>{
    const tab=await context.newPage();
    tab.setDefaultTimeout(12000);
    await tab.addInitScript(()=>{
      try{localStorage.removeItem('nawaa_price_history_v1');}catch{}
      window.__criticalPath=[];
      window.__nawaaSkippedDuplicate=0;
      window.__nawaaFirstCardDom=null;
      window.__nawaaFirstCardFrame=null;
      const attach=()=>{
        const root=document.querySelector('#results');
        if(!root)return;
        const observe=()=>{
          if(window.__nawaaFirstCardDom!==null)return;
          if(!root.querySelector('.match-result-card'))return;
          window.__nawaaFirstCardDom=performance.now();
          requestAnimationFrame(()=>{window.__nawaaFirstCardFrame=performance.now();});
        };
        new MutationObserver(observe).observe(root,{childList:true,subtree:true});
        observe();
      };
      if(document.readyState==='loading')
        document.addEventListener('DOMContentLoaded',attach,{once:true});
      else attach();
    });
    if(candidate)await tab.route(url=>url.hostname==='127.0.0.1'&&url.pathname==='/src/search-page.mjs',
      async route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:candidateSource}));
    try{
      await tab.goto(base+'/search.html?q='+encodeURIComponent(query),
        {waitUntil:'domcontentloaded',timeout:20000});
      await tab.waitForFunction(()=>{
        const status=document.querySelector('#searchStatus')?.textContent||'';
        return status.startsWith('بحث حي:')&&
          Number.isFinite(window.__nawaaFirstCardFrame);
      },null,{timeout:12000});
      return await tab.evaluate(()=>{
        const content=document.querySelector('#results')?.textContent?.replace(/\s+/g,' ').trim()||'';
        const cards=[...document.querySelectorAll('#results .match-result-card')].map(c=>({
          group:c.dataset.groupKey||null,title:c.querySelector('.match-card-copy strong')?.textContent?.trim()||'',
          price:c.querySelector('.match-card-price b')?.textContent?.trim()||''
        }));
        const tasks=window.__criticalPath||[];
        return {cards,content,status:document.querySelector('#searchStatus')?.textContent||'',
          history:localStorage.getItem('nawaa_price_history_v1'),
          loadMore:document.querySelector('#loadMoreRemote')?.textContent||null,
          domToFrameMs:Math.round((window.__nawaaFirstCardFrame-window.__nawaaFirstCardDom)*100)/100,
          skipped:Number(window.__nawaaSkippedDuplicate||0),
          compareMs:tasks.filter(x=>x.phase==='candidate.deepCompare').reduce((a,b)=>a+b.ms,0),
          historyCalls:tasks.filter(x=>x.phase==='history.total').length,
          renderCalls:tasks.filter(x=>x.phase==='render.total').length};
      });
    }finally{await tab.close();}
  };
  for(const [name,query,rounds] of counterCases){
    for(let round=0;round<rounds;round++){
      const order=round%2?[true,false]:[false,true];
      const outcomes={};
      for(const candidate of order)outcomes[candidate?'candidate':'original']=await executeCounter(query,candidate);
      const original=outcomes.original,optimized=outcomes.candidate;
      const expectedSkip=name==='duplicate'?1:0;
      const semanticallySame=JSON.stringify({
        cards:original.cards,content:original.content,status:original.status,
        history:original.history,loadMore:original.loadMore
      })===JSON.stringify({
        cards:optimized.cards,content:optimized.content,status:optimized.status,
        history:optimized.history,loadMore:optimized.loadMore
      });
      const item={name,round,semanticallySame,
        originalFrameMs:original.domToFrameMs,candidateFrameMs:optimized.domToFrameMs,
        originalHistoryCalls:original.historyCalls,candidateHistoryCalls:optimized.historyCalls,
        originalRenderCalls:original.renderCalls,candidateRenderCalls:optimized.renderCalls,
        actualSkip:optimized.skipped,expectedSkip,compareMs:Math.round(optimized.compareMs*100)/100};
      counterResults.samples.push(item);
      assertCheck('counterfactual_'+name+'_'+round,
        semanticallySame&&optimized.skipped===expectedSkip&&
        (expectedSkip===1?
          original.renderCalls===optimized.renderCalls+1&&original.historyCalls===optimized.historyCalls+1:
          original.renderCalls===optimized.renderCalls&&original.historyCalls===optimized.historyCalls),
        item);
    }
  }
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  counterResults.duplicate=(()=>{
    const data=counterResults.samples.filter(x=>x.name==='duplicate');
    return {n:data.length,originalFrameMeanMs:Math.round(mean(data.map(x=>x.originalFrameMs))*100)/100,
      candidateFrameMeanMs:Math.round(mean(data.map(x=>x.candidateFrameMs))*100)/100,
      comparisonOverheadMeanMs:Math.round(mean(data.map(x=>x.compareMs))*100)/100};
  })();
  traces.counterfactual=counterResults;
  writeFileSync('browser-artifacts/fixture-counterfactual-v2154.json',JSON.stringify(counterResults,null,2));
  console.log('NAWAA_V2154_COUNTERFACTUAL '+JSON.stringify(counterResults));

  // v21.55: controlled SSE micro-simulation. No customer-facing module is
  // changed. Compare render-only deduplication to original instrumented code:
  // price-history writes and final reconciliation remain enabled in both.
  let renderOnlyCandidate=patchedSource;
  const transformRenderOnly=(from,to,label)=>{
    const n=renderOnlyCandidate.split(from).length-1;
    if(n!==1)throw Error('render_only_anchor_'+label+'_'+n);
    renderOnlyCandidate=renderOnlyCandidate.replace(from,to);
  };
  transformRenderOnly('          let bestWithOffers=null;',
    '          let bestWithOffers=null;\n          let lastRenderedPayload=null;', 'scoped_snapshot');
  transformRenderOnly('              best=payload;',
    '              const __sameRenderedPayload=event.data===lastRenderedPayload && !state.comparisonOpen && !state.selectedGroupKey;\n'+
    '              best=payload;', 'same_payload');
  transformRenderOnly('                __criticalSpan("render.total",()=>renderProduct(liveProduct,query));',
    '                if(!__sameRenderedPayload){\n'+
    '                  __criticalSpan("render.total",()=>renderProduct(liveProduct,query));\n'+
    '                  lastRenderedPayload=event.data;\n'+
    '                }else window.__renderOnlySkips=(window.__renderOnlySkips||0)+1;', 'render_only');
  const sourceForCase=async({candidate,variant,interaction,offsetSeconds=null})=>{
    const q=variant==='perf48'?'HP laptop fixture-performance-48-single':
      'HP laptop fixture-performance-6-single';
    const payload=searchPayload(q,null);
    const makeOffer=x=>variant==='missingObservedAt'?(({observedAt,...others})=>others)(x):x;
    const full={...payload,offers:payload.offers.map(makeOffer)};
    const changed={...full,offers:full.offers.map((o,i)=>i===0?{...o,productPrice:o.productPrice+91}:o)};
    const chronological=offsetSeconds===null?null:{...full,offers:full.offers.map(o=>({
      ...o,observedAt:new Date(Date.parse(o.observedAt)+offsetSeconds*1000).toISOString()
    }))};
    const tab=await context.newPage();
    tab.setDefaultTimeout(10000);
    await tab.addInitScript(()=>{
      const NativeDate=Date;
      window.__controlledTicks=0;
      window.Date=class extends NativeDate{
        constructor(...args){if(args.length)super(...args);else super(1790000000000+window.__controlledTicks*3000);}
        static now(){return 1790000000000+window.__controlledTicks*3000;}
      };
      try{localStorage.removeItem('nawaa_price_history_v1');}catch{}
      window.__criticalPath=[];
      window.__renderOnlySkips=0;
      window.__controlledStream=null;
      window.EventSource=class{
        constructor(){
          this.handlers=new Map();
          window.__controlledStream=this;
        }
        addEventListener(name,fn){
          if(!this.handlers.has(name))this.handlers.set(name,[]);
          this.handlers.get(name).push(fn);
        }
        sendSnapshot(body){
          window.__controlledTicks++;
          for(const fn of this.handlers.get('snapshot')||[])fn({data:JSON.stringify(body)});
        }
        done(){for(const fn of this.handlers.get('done')||[])fn({data:'{}'});}
        close(){this.closed=true;}
      };
    });
    await tab.route(url=>url.hostname==='127.0.0.1'&&url.pathname==='/src/search-page.mjs',
      async route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',
        body:candidate?renderOnlyCandidate:patchedSource}));
    const measure=()=>tab.evaluate(()=>{
      const cards=[...document.querySelectorAll('#results .match-result-card')].map(c=>({
        group:c.dataset.groupKey||'',title:c.querySelector('.match-card-copy strong')?.textContent||''
      }));
      const raw=localStorage.getItem('nawaa_price_history_v1');
      const history=raw?JSON.parse(raw):[];
      const task=window.__criticalPath||[];
      return {
        cards,
        status:document.querySelector('#searchStatus')?.textContent||'',
        focused:document.activeElement?.dataset?.groupKey||null,
        selected:document.querySelector('.selected-comparison')?.textContent?.replace(/\s+/g,' ').trim()||null,
        merchant:document.querySelector('#merchantFilter')?.value||'all',
        renderCalls:task.filter(x=>x.phase==='render.total').length,
        historyCalls:task.filter(x=>x.phase==='history.total').length,
        skips:window.__renderOnlySkips||0,
        history,html:document.querySelector('#results')?.textContent?.replace(/\s+/g,' ').trim()||''
      };
    });
    try{
      await tab.goto(base+'/search.html?q='+encodeURIComponent(q),{waitUntil:'domcontentloaded'});
      await tab.waitForFunction(()=>Boolean(window.__controlledStream),null,{timeout:6000});
      await tab.evaluate(p=>window.__controlledStream.sendSnapshot(p),full);
      await tab.locator('#results .match-result-card').first().waitFor();
      const before=await measure();
      if(interaction==='focus')await tab.locator('#results .match-result-card').first().focus();
      if(interaction==='filter')await tab.locator('#merchantFilter').selectOption('Jarir');
      if(interaction==='comparison')await tab.locator('#results .match-result-card').first().click();
      if(interaction==='keyboard')await tab.locator('#results .match-result-card').first().focus();
      const first=await measure();
      const duplicateHandlerMs=await tab.evaluate(p=>{
        const started=performance.now();
        window.__controlledStream.sendSnapshot(p);
        return performance.now()-started;
      },variant==='priceMutation'?changed:offsetSeconds!==null?chronological:full);
      const second=await measure();
      await tab.evaluate(()=>window.__controlledStream.done());
      await tab.waitForFunction(()=>document.querySelector('#searchStatus')?.textContent?.startsWith('بحث حي:'),
        null,{timeout:6000});
      const final=await measure();
      return {before,first,second,final,duplicateHandlerMs};
    }finally{await tab.close();}
  };
  const renderOnlyCases=[
    ['plain','explicit','none',1],
    ['noTimestamp','missingObservedAt','none',1],
    ['focus','explicit','focus',1],
    ['filter','explicit','filter',1],
    ['comparison','explicit','comparison',0],
    ['keyboard','explicit','keyboard',1],
    ['changingPrice','priceMutation','none',0],
    ['perf48_1','perf48','none',1],
    ['perf48_2','perf48','none',1],
    ['perf48_3','perf48','none',1],
    ['v2156_older_timestamp','chronology','none',0,-3600],
    ['v2156_newer_timestamp','chronology','none',0,3600],
    ...fc.sample(fc.integer({min:-7200,max:7200}).filter(n=>n!==0),
      {seed:2146,numRuns:8}).map((seconds,i)=>['property_chronology_'+i,'chronology','none',0,seconds]),
  ];
  const renderOnlyReport={kind:'test_only_render_only_snapshot_counterfactual',
    source:'unchanged production module instrumented at Chromium request interception',
    independentMerchantProvenanceCertified:false,p95Certified:false,samples:[]};
  for(const [name,variant,interaction,expectedSkip,offsetSeconds=null] of renderOnlyCases){
    const results={};
    const runOrder=name==='perf48_2'?[true,false]:[false,true];
    for(const candidate of runOrder)
      results[candidate?'candidate':'original']=await sourceForCase({candidate,variant,interaction,offsetSeconds});
    const a=results.original,b=results.candidate;
    const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
    const parity=['before','first','second','final'].every(stage=>{
      const l=a[stage],r=b[stage];
      return same(l.cards,r.cards)&&l.status===r.status&&
        l.focused===r.focused&&l.selected===r.selected&&
        l.merchant===r.merchant&&same(l.history,r.history)&&l.html===r.html;
    });
    const historyPreserved=a.second.historyCalls===b.second.historyCalls&&
      same(a.second.history,b.second.history)&&
      a.final.historyCalls===b.final.historyCalls;
    const lastSeenAdvances=variant==='missingObservedAt'?
      a.before.history.length>0&&
      a.before.history.some((row,i)=>row.lastSeenAt!==a.second.history[i]?.lastSeenAt):
      true;
    const chronologicallySafe=offsetSeconds===null||[a,b].every(result=>
      result.before.history.every(before=>{
        const matching=result.second.history.find(point=>
          point.variantKey===before.variantKey&&point.merchant===before.merchant&&
          point.value===before.value&&point.priceBasis===before.priceBasis);
        if(!matching)return false;
        const prior=Date.parse(before.lastSeenAt),after=Date.parse(matching.lastSeenAt);
        if(after<prior)return false;
        const expected=offsetSeconds>0?prior+offsetSeconds*1000:prior;
        return after===expected;
      }));
    const skipped=b.second.skips;
    const item={name,parity,historyPreserved,lastSeenAdvances,chronologicallySafe,offsetSeconds,skipped,expectedSkip,
      renderCallsAtSecond:[a.second.renderCalls,b.second.renderCalls],
      historyCallsAtSecond:[a.second.historyCalls,b.second.historyCalls],
      finalRenderCalls:[a.final.renderCalls,b.final.renderCalls],
      duplicateHandlerMs:[a.duplicateHandlerMs,b.duplicateHandlerMs]};
    renderOnlyReport.samples.push(item);
    assertCheck('v2155_render_only_'+name,
      parity&&historyPreserved&&lastSeenAdvances&&chronologicallySafe&&skipped===expectedSkip&&
      a.second.renderCalls===b.second.renderCalls+expectedSkip&&
      a.final.renderCalls===b.final.renderCalls+expectedSkip,item);
  }
  renderOnlyReport.handlerBenchmark={
    scope:'same-source Chromium micro-simulation; duplicate snapshot handler duration only',
    environment:'synthetic 48-offer fixture; three paired trials, alternating order',
    samples:renderOnlyReport.samples.filter(x=>x.name.startsWith('perf48_')).map(x=>({
      name:x.name,baselineMs:x.duplicateHandlerMs[0],candidateMs:x.duplicateHandlerMs[1],
      deltaMs:x.duplicateHandlerMs[0]-x.duplicateHandlerMs[1]
    })),
    firstOfferP95Certified:false,customerPaintCertified:false,productionOptimizationApplied:false
  };
  writeFileSync('browser-artifacts/fixture-render-only-v2155.json',JSON.stringify(renderOnlyReport,null,2));
  console.log('NAWAA_V2155_RENDER_ONLY '+JSON.stringify(renderOnlyReport));
  // v21.56: deterministic lifecycle RED/ GREEN on the exact customer module.
  // Manually delivered events and timeouts expose obsolete fallback requests and
  // post-terminal snapshots without waiting 30 real seconds or calling merchants.
  const lifecycleTab=await context.newPage();
  lifecycleTab.setDefaultTimeout(10000);
  await lifecycleTab.addInitScript(()=>{
    try{localStorage.removeItem('nawaa_price_history_v1');}catch{}
    window.__lifecycleStreams=[];
    window.__lifecycleFallbacks=[];
    window.__lifecycleTimeouts=[];
    const originalSetTimeout=window.setTimeout.bind(window);
    const originalClearTimeout=window.clearTimeout.bind(window);
    window.setTimeout=(callback,delay,...args)=>{
      if(delay===30000){
        const entry={id:-(window.__lifecycleTimeouts.length+1),
          callback:()=>callback(...args),cleared:false,fired:false};
        window.__lifecycleTimeouts.push(entry);
        return entry.id;
      }
      return originalSetTimeout(callback,delay,...args);
    };
    window.clearTimeout=id=>{
      const entry=window.__lifecycleTimeouts.find(t=>t.id===id);
      if(entry){entry.cleared=true;return;}
      return originalClearTimeout(id);
    };
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input,...rest)=>{
      const value=typeof input==='string'?input:input?.url||'';
      if(value.includes('/api/search?'))window.__lifecycleFallbacks.push(value);
      return originalFetch(input,...rest);
    };
    window.EventSource=class{
      constructor(url){
        this.url=url;this.listeners=new Map();this.closeCalls=0;this.closed=false;
        window.__lifecycleStreams.push(this);
      }
      addEventListener(type,listener){
        if(!this.listeners.has(type))this.listeners.set(type,[]);
        this.listeners.get(type).push(listener);
      }
      emit(type,data='{}'){
        for(const listener of this.listeners.get(type)||[])listener({data});
      }
      snapshot(data){this.emit('snapshot',JSON.stringify(data));}
      done(){this.emit('done');}
      error(){this.emit('error');}
      close(){this.closed=true;this.closeCalls++;}
    };
    window.__firePendingStreamTimers=indices=>{
      for(const i of indices){
        const timer=window.__lifecycleTimeouts[i];
        if(!timer||timer.cleared||timer.fired)continue;
        timer.fired=true;timer.callback();
      }
    };
  });
  await lifecycleTab.route(url=>url.hostname==='127.0.0.1'&&url.pathname==='/src/search-page.mjs',
    async route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',
      body:readFileSync(new URL('../src/search-page.mjs',import.meta.url),'utf8')}));
  const lifecycleQueryA='HP laptop fixture-performance-6-single';
  const lifecycleQueryB='HP laptop fixture-performance-24-single';
  try{
    await lifecycleTab.goto(base+'/search.html?q='+encodeURIComponent(lifecycleQueryA),
      {waitUntil:'domcontentloaded',timeout:20000});
    await lifecycleTab.waitForFunction(()=>window.__lifecycleStreams.length===1);
    await lifecycleTab.evaluate(query=>{
      document.querySelector('#searchInput').value=query;
      document.querySelector('#searchForm').requestSubmit();
    },lifecycleQueryB);
    await lifecycleTab.waitForFunction(()=>window.__lifecycleStreams.length===2);
    const canceled=await lifecycleTab.evaluate(()=>({
      firstClosed:window.__lifecycleStreams[0].closed,
      firstTimeoutCleared:window.__lifecycleTimeouts[0]?.cleared||false,
      timerCount:window.__lifecycleTimeouts.length
    }));
    assertCheck('v2156_cancel_closes_and_clears_prior_timer',
      canceled.firstClosed&&canceled.firstTimeoutCleared&&canceled.timerCount===2,canceled);
    await lifecycleTab.evaluate(p=>window.__lifecycleStreams[1].snapshot(p),
      searchPayload(lifecycleQueryB,null));
    const beforeLate=await lifecycleTab.evaluate(()=>({
      cards:document.querySelectorAll('#results .match-result-card').length,
      status:document.querySelector('#searchStatus')?.textContent||''
    }));
    await lifecycleTab.evaluate(p=>{
      const old=window.__lifecycleStreams[0];
      window.__firePendingStreamTimers([0]);
      old.snapshot(p);old.done();old.error();
    },searchPayload(lifecycleQueryA,null));
    await lifecycleTab.waitForTimeout(80);
    const afterLate=await lifecycleTab.evaluate(()=>({
      cards:document.querySelectorAll('#results .match-result-card').length,
      status:document.querySelector('#searchStatus')?.textContent||'',
      fallbacks:window.__lifecycleFallbacks.slice()
    }));
    assertCheck('v2156_old_stream_cannot_schedule_json_fallback',
      afterLate.fallbacks.length===0,afterLate);
    assertCheck('v2156_old_stream_does_not_mutate_new_search',
      beforeLate.cards===afterLate.cards&&
      beforeLate.status===afterLate.status&&beforeLate.cards===10,
      {beforeLate,afterLate});
    await lifecycleTab.evaluate(()=>window.__lifecycleStreams[1].done());
    await lifecycleTab.waitForFunction(()=>document.querySelector('#searchStatus')?.textContent?.startsWith('بحث حي:'));
    const beforeTerminalReplay=await lifecycleTab.evaluate(()=>({
      cards:[...document.querySelectorAll('#results .match-result-card')].map(c=>c.dataset.groupKey),
      status:document.querySelector('#searchStatus')?.textContent||'',
      history:localStorage.getItem('nawaa_price_history_v1'),
      closeCalls:window.__lifecycleStreams[1].closeCalls,
      secondTimeoutCleared:window.__lifecycleTimeouts[1]?.cleared||false
    }));
    await lifecycleTab.evaluate(p=>{
      const stream=window.__lifecycleStreams[1];
      stream.done();stream.error();stream.snapshot(p);
      window.__firePendingStreamTimers([1]);
    },searchPayload(lifecycleQueryA,null));
    await lifecycleTab.waitForTimeout(80);
    const afterTerminalReplay=await lifecycleTab.evaluate(()=>({
      cards:[...document.querySelectorAll('#results .match-result-card')].map(c=>c.dataset.groupKey),
      status:document.querySelector('#searchStatus')?.textContent||'',
      history:localStorage.getItem('nawaa_price_history_v1'),
      closeCalls:window.__lifecycleStreams[1].closeCalls,
      secondTimeoutCleared:window.__lifecycleTimeouts[1]?.cleared||false,
      fallbacks:window.__lifecycleFallbacks.slice()
    }));
    const identical=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    assertCheck('v2156_terminal_idempotent_and_post_done_snapshot_ignored',
      identical(beforeTerminalReplay.cards,afterTerminalReplay.cards)&&
      beforeTerminalReplay.status===afterTerminalReplay.status&&
      beforeTerminalReplay.history===afterTerminalReplay.history&&
      beforeTerminalReplay.closeCalls===1&&afterTerminalReplay.closeCalls===1&&
      beforeTerminalReplay.secondTimeoutCleared&&afterTerminalReplay.secondTimeoutCleared&&
      afterTerminalReplay.fallbacks.length===0,
      {beforeTerminalReplay,afterTerminalReplay});
    // Cancel after a valid offer, then deliver the old terminal/error messages
    // while a third-generation search is still streaming.
    const submitLifecycle=async query=>lifecycleTab.evaluate(q=>{
      document.querySelector('#searchInput').value=q;
      document.querySelector('#searchForm').requestSubmit();
    },query);
    await submitLifecycle(lifecycleQueryA);
    await lifecycleTab.waitForFunction(()=>window.__lifecycleStreams.length===3);
    await lifecycleTab.evaluate(p=>window.__lifecycleStreams[2].snapshot(p),
      searchPayload(lifecycleQueryA,null));
    await lifecycleTab.locator('#results .match-result-card').first().waitFor();
    await submitLifecycle(lifecycleQueryB);
    await lifecycleTab.waitForFunction(()=>window.__lifecycleStreams.length===4);
    const thirdCanceled=await lifecycleTab.evaluate(()=>({
      closed:window.__lifecycleStreams[2].closed,
      timerCleared:window.__lifecycleTimeouts[2]?.cleared||false,
      fallbacks:window.__lifecycleFallbacks.length
    }));
    await lifecycleTab.evaluate(p=>window.__lifecycleStreams[3].snapshot(p),
      searchPayload(lifecycleQueryB,null));
    const newestBefore=await lifecycleTab.evaluate(()=>({
      text:document.querySelector('#results')?.textContent||'',
      status:document.querySelector('#searchStatus')?.textContent||''
    }));
    await lifecycleTab.evaluate(p=>{
      const obsolete=window.__lifecycleStreams[2];
      obsolete.snapshot(p);obsolete.done();obsolete.error();
      window.__firePendingStreamTimers([2]);
    },searchPayload(lifecycleQueryA,null));
    await lifecycleTab.waitForTimeout(70);
    const newestAfter=await lifecycleTab.evaluate(()=>({
      text:document.querySelector('#results')?.textContent||'',
      status:document.querySelector('#searchStatus')?.textContent||'',
      fallbacks:window.__lifecycleFallbacks.length
    }));
    assertCheck('v2156_cancel_after_offer_then_supersede_is_safe',
      thirdCanceled.closed&&thirdCanceled.timerCleared&&
      newestBefore.text===newestAfter.text&&
      newestBefore.status===newestAfter.status&&
      thirdCanceled.fallbacks===newestAfter.fallbacks,
      {thirdCanceled,newestBefore,newestAfter});
    await lifecycleTab.evaluate(()=>window.__lifecycleStreams[3].done());
    await lifecycleTab.waitForFunction(()=>document.querySelector('#searchStatus')?.textContent?.startsWith('بحث حي:'));

    // A disposed page must not initiate a new fallback after its stream settles.
    await submitLifecycle(lifecycleQueryA);
    await lifecycleTab.waitForFunction(()=>window.__lifecycleStreams.length===5);
    const fallbackCountBeforeHide=await lifecycleTab.evaluate(()=>window.__lifecycleFallbacks.length);
    await lifecycleTab.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await lifecycleTab.waitForTimeout(70);
    const dispose=await lifecycleTab.evaluate((fallbackCountBeforeHide)=>({
      closed:window.__lifecycleStreams[4].closed,
      timeoutCleared:window.__lifecycleTimeouts[4]?.cleared||false,
      fallbacksBefore:fallbackCountBeforeHide,
      fallbacksAfter:window.__lifecycleFallbacks.length
    }),fallbackCountBeforeHide);
    assertCheck('v2156_pagehide_releases_stream_without_fallback',
      dispose.closed&&dispose.timeoutCleared&&
      dispose.fallbacksBefore===dispose.fallbacksAfter,dispose);
    const lifecycleEvidence={canceled,beforeLate,afterLate,beforeTerminalReplay,afterTerminalReplay,
      thirdCanceled,newestBefore,newestAfter,dispose,
      scope:'fixture controlled events; actual production module, no external merchants',
      p95Certified:false};
    writeFileSync('browser-artifacts/fixture-sse-lifecycle-v2156.json',
      JSON.stringify(lifecycleEvidence,null,2));
    console.log('NAWAA_V2156_SSE_LIFECYCLE '+JSON.stringify(lifecycleEvidence));
  }finally{await lifecycleTab.close();}
  summary.browserForensics=traces;
  writeFileSync('browser-artifacts/fixture-browser-forensics.json',JSON.stringify(traces,null,2));
  console.log('NAWAA_FIXTURE_BROWSER_FORENSICS '+JSON.stringify(traces));
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
