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
  // Fail with a precise cause instead of waiting 55s if the production page's
  // ESM dependency graph is omitted from the explicit localhost allowlist.
  if(mode==='candidate'){
    const required=['/src/search-page.mjs','/src/search-first-offer-metrics.mjs',
      '/src/product-image-ownership.mjs'];
    const checks=await Promise.all(required.map(async asset=>{
      const response=await fetch(base+asset,{signal:AbortSignal.timeout(5000)});
      return {asset,status:response.status,js:(response.headers.get('content-type')||'').includes('text/javascript')};
    }));
    report.moduleReachability=checks;
    report.assertions.customerModuleImportsReachable=checks.every(x=>x.status===200&&x.js);
    if(!report.assertions.customerModuleImportsReachable)
      throw Error('candidate_browser_module_graph_not_served');
  }
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
    // Browser-only, no merchant requests or production instrumentation.
    // These are observation boundaries, NOT proof of source-owned price/SKU
    // and NOT a guarantee that a card was painted to physical pixels.
    window.__nawaaObserved = {first:[],suspicious:[],done:false,snapshots:0,
      latestOfferCount:0,latestMerchantNames:[],latestMarkets:[],
      sseOpenedAtMs:null,firstOfferSnapshotAtMs:null,firstExactCandidateSnapshotAtMs:null,
      firstCardDomAtMs:null,firstCardFrameAtMs:null};
    const watchFirstCard = () => {
      const root=document.querySelector('#results');
      if(!root)return;
      const inspect=()=>{
        const record=window.__nawaaObserved;
        if(record.firstCardDomAtMs!==null || !root.querySelector('.match-result-card'))return;
        record.firstCardDomAtMs=performance.now();
        requestAnimationFrame(()=>{
          if(record.firstCardFrameAtMs===null && root.querySelector('.match-result-card'))
            record.firstCardFrameAtMs=performance.now();
        });
      };
      new MutationObserver(inspect).observe(root,{childList:true,subtree:true});
      inspect();
    };
    if(document.readyState==='loading')
      document.addEventListener('DOMContentLoaded',watchFirstCard,{once:true});
    else watchFirstCard();
    window.EventSource = class extends Native {
      constructor(...args) {
        super(...args);
        window.__nawaaObserved.sseOpenedAtMs ??= performance.now();
        this.addEventListener("snapshot", event => {
          try {
            const offers = JSON.parse(event.data)?.offers || [];
            const record = window.__nawaaObserved;
            record.snapshots++;
            const receivedAt=performance.now();
            if(record.firstOfferSnapshotAtMs===null && offers.length)
              record.firstOfferSnapshotAtMs=receivedAt;
            // Matches the UI's initial exact-group selection preconditions;
            // does not independently validate price, identity or provenance.
            if(record.firstExactCandidateSnapshotAtMs===null &&
              offers.some(o=>o?.exactMatch===true && Number(o.matchConfidence)>=0.9 &&
                o.condition==='new'))
              record.firstExactCandidateSnapshotAtMs=receivedAt;
            record.latestOfferCount=offers.length;
            record.latestMerchantNames=[...new Set(offers.map(o => String(o.merchant||'').slice(0,65)).filter(Boolean))];
            record.latestMarkets=[...new Set(offers.map(o => String(o.providerMarket||'').slice(0,70)).filter(Boolean))];
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
    if(report.resourceFailures.length>=20)return;
    const type=req.resourceType();
    // Hostname only: diagnose CDN embed restrictions without storing signed
    // image URLs, query parameters, cookies or private image paths.
    let imageDomain=null;
    if(type==='image'){try{imageDomain=new URL(req.url()).hostname}catch{}}
    report.resourceFailures.push({
      type,reason:sanitize(req.failure()?.errorText),
      ...(imageDomain?{imageDomain}:{})});
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
  if(report.results.cards>0){
    // DOM insertion and rAF are distinct; neither proves actual display
    // compositor paint or attribution to a specific owned merchant Offer.
    await page.waitForFunction(
      ()=>Number.isFinite(window.__nawaaObserved?.firstCardFrameAtMs),
      null,{timeout:3500});
  }
  report.browserLatencyPhases=await page.evaluate(()=>{
    const record=window.__nawaaObserved||{};
    const elapsed=(end,start)=>Number.isFinite(end)&&Number.isFinite(start)&&end>=start
      ? Math.round(end-start) : null;
    return {
      firstOfferSnapshotFromSseOpenMs:elapsed(record.firstOfferSnapshotAtMs,record.sseOpenedAtMs),
      firstExactCandidateSnapshotFromSseOpenMs:elapsed(record.firstExactCandidateSnapshotAtMs,record.sseOpenedAtMs),
      firstCardDomFromNavigationMs:Number.isFinite(record.firstCardDomAtMs)?Math.round(record.firstCardDomAtMs):null,
      firstCardFrameFromNavigationMs:Number.isFinite(record.firstCardFrameAtMs)?Math.round(record.firstCardFrameAtMs):null,
      firstCardDomFromSseOpenMs:elapsed(record.firstCardDomAtMs,record.sseOpenedAtMs),
      firstCardFrameFromSseOpenMs:elapsed(record.firstCardFrameAtMs,record.sseOpenedAtMs),
      domToFrameOpportunityMs:elapsed(record.firstCardFrameAtMs,record.firstCardDomAtMs),
      milestoneScope:'browser_DOM_and_animation_frame_opportunity_only',
      sameSellableOfferOwnershipCertified:false,firstCardPaintCertified:false,
      p95Certified:false
    };
  });
  if(mode==='candidate'&&report.results.cards>0)
    report.assertions.firstCardFrameTimingRecorded=
      Number.isFinite(report.browserLatencyPhases.firstCardFrameFromNavigationMs)&&
      Number.isFinite(report.browserLatencyPhases.domToFrameOpportunityMs);
  // Inspect the same actual SSE search: no extra merchant acquisition or fixture data.
  // The initial render and the completed stream are separate customer experiences.
  if(mode==='candidate'||/ps5/i.test(query)){
    await page.waitForFunction(() => window.__nawaaObserved?.done, null, {timeout:22000}).catch(()=>{});
  }
  const observed=await page.evaluate(()=>window.__nawaaObserved||null);
  report.streamCompletion={
    done:observed?.done===true,
    snapshots:observed?.snapshots||0,
    latestOfferCount:observed?.latestOfferCount||0,
    uniqueMerchantsInStream:observed?.latestMerchantNames?.length||0,
    uniqueMarketsInStream:observed?.latestMarkets?.length||0,
    merchantNames:observed?.latestMerchantNames||[],
  };
  if (/ps5/i.test(query)) {
    // Capture product identity from the very same SSE event the shopper saw.
    report.ps5SourceEvidence=observed;
    if(mode==='candidate'){
      // Real merchant-product regression using the already received SSE events.
      // Accessories may be offered as related products, but cannot be exact PS5 consoles.
      const accessoryPath=/(?:other-gaming-accessories-644723|other-gaming-accessories-629492|B09DRTJ194|B08VW55CSZ|B0CQD48RJS|B09NXT3NMW|\/playstation-games\/)/i;
      // Name-based product-type signal protects against a new ASIN for a
      // standalone stand; a genuine PS5 console INCLUDING a stand is safe.
      const standaloneStand=/^(?:sony )?(?:ps[45]|playstation [45]) (?:vertical |replacement )?stands?\b|\b(?:vertical|replacement) stands? for (?:sony )?(?:ps[45]|playstation [45])\b/i;
      const includedConsole=/^(?:sony )?(?:ps[45]|playstation [45])\b.*\bconsole\b.*\b(?:with|includes|including)\b.*\bstands?\b/i;
      const captured=[...(report.ps5SourceEvidence?.first||[]),...(report.ps5SourceEvidence?.suspicious||[])];
      report.assertions.noKnownAccessoryCertifiedConsole=!captured.some(
        offer=>offer.exactMatch === true &&
          (accessoryPath.test(offer.source||'') ||
          (standaloneStand.test(offer.title||'') && !includedConsole.test(offer.title||''))));
    }
  }
  // Browser-observed first TEN actual product cards (not raw offer records).
  // A card can contain several merchants, and several cards can represent
  // distinct qualified variants from the same merchant. Never mix the units.
  if(mode==='candidate'&&report.results.cards>0){
    report.firstTenGroups=[];
    const visibleCount=Math.min(10,await page.locator('#results .match-result-card').count());
    for(let i=0;i<visibleCount;i++){
      const row=await page.evaluate(index=>{
        const card=[...document.querySelectorAll('#results .match-result-card')][index];
        if(!card)return {error:'card_disappeared',index};
        const title=card.querySelector('.match-card-copy strong')?.textContent?.trim()||'';
        const advertisedPrice=card.querySelector('.match-card-price b')?.textContent?.trim()||'';
        const coverage=card.querySelector('.card-coverage')?.textContent?.trim()||'';
        card.click();
        const panel=document.querySelector('#results .selected-comparison[open]');
        const merchants=[...panel?.querySelectorAll('.merchant-row .merchant-main strong')||[]]
          .map(node=>node.textContent?.trim()||'').filter(Boolean);
        const merchantRows=panel?.querySelectorAll('.merchant-row').length||0;
        const details=[...panel?.querySelectorAll('.product-detail-btn[data-source]')||[]];
        const detailActions=details.length;
        // Read only links already visible in the real customer's comparison
        // drawer; no additional merchant requests or application mutation.
        // Preserve product pathname for independent seller-SKU/variant audit.
        const offerSourcePaths=details.slice(0,12).map(button=>{
          try{
            const url=new URL(button.getAttribute('data-source')||'');
            return url.protocol==='https:' ? url.origin+url.pathname : null;
          }catch{return null;}
        }).filter(Boolean);
        return {index,title,advertisedPrice,coverage,merchantNames:[...new Set(merchants)],
          merchantRows,detailActions,offerSourcePaths};
      },i);
      report.firstTenGroups.push(row);
    }
    const allMerchants=new Set(report.firstTenGroups.flatMap(group=>group.merchantNames||[]));
    report.firstTenSummary={
      actualVisibleProductGroups:report.firstTenGroups.length,
      distinctMerchantsAcrossGroups:allMerchants.size,
      groupsWithMultipleMerchants:report.firstTenGroups.filter(group=>group.merchantNames?.length>1).length,
      totalOfferRowsInComparisons:report.firstTenGroups.reduce((sum,group)=>sum+(group.merchantRows||0),0),
      duplicateLookingTitles:report.firstTenGroups.length-
        new Set(report.firstTenGroups.map(group=>group.title)).size,
      merchantNames:[...allMerchants],
      recordedAfterStreamCompletion:report.streamCompletion.done,
    };
    // v21.6: actual cross-merchant first-ten browser acceptance against the
    // two independently inspected same-MPN Saudi merchant product pairs.
    // A pair can be absent due to upstream volatility; report that explicitly
    // rather than treating absence as a verified grouping success.
    if (query === 'iPhone 17') {
      const observedPairs = [
        {color:'Black',jarir:'/sa-en/apple-iphone-17-smartphones-666784.html',extra:'/en-sa/p/100460151'},
        {color:'Lavender',jarir:'/sa-en/apple-iphone-17-smartphones-666789.html',extra:'/en-sa/p/100460146'}
      ].map(pair=>{
        const findGroup = path => report.firstTenGroups.findIndex(group=>
          (group.offerSourcePaths||[]).some(url=>url.endsWith(path)));
        const jarirGroup=findGroup(pair.jarir), extraGroup=findGroup(pair.extra);
        const bothVisible=jarirGroup>=0 && extraGroup>=0;
        return {color:pair.color,jarirGroup,extraGroup,bothVisible,
          grouped:bothVisible && jarirGroup===extraGroup,
          evidenceClass:'candidate_browser_observation'};
      });
      report.iphoneCrossMerchantGrouping={
        observedPairs,verifiedTogether:observedPairs.filter(pair=>pair.grouped).length,
        pairsBothVisible:observedPairs.filter(pair=>pair.bothVisible).length,
        limitation:'first_ten_only_missing_pair_is_not_verified_not_price_or_region_certification'
      };
      report.assertions.noSeparatedVerifiedMerchantPairs=
        observedPairs.every(pair=>!pair.bothVisible || pair.grouped);
    }
    report.assertions.firstTenComparisonsUsable=report.firstTenGroups.every(group=>
      Boolean(group.title)&&group.merchantRows>0&&group.detailActions>0);

    // Real Best Buy PDPs #6443168/#6443134 were observed occupying the
    // generic Saudi-first iPhone17 first-ten. The merchant explicitly denotes
    // AT&T/Verizon activation-plan variants, not verified unlocked/Saudi-ready
    // devices. They remain relevant only to explicit carrier searches.
    if(query==='iPhone 17'){
      const carrierPlanCards=report.firstTenGroups.filter(group=>
        /\(\s*(?:at\s*&\s*t|verizon|t[- ]mobile)\s*\)/i.test(group.title||''));
      report.iphoneCarrierComparability={
        query,groupsInspected:report.firstTenGroups.length,
        unrequestedCarrierPlanTitles:carrierPlanCards.map(group=>group.title),
        assertionScope:'explicit_carrier_plan_titles_only_not_shipping_or_SIM_lock_certification'
      };
      report.assertions.noUnrequestedCarrierPlanAtFirstTen=carrierPlanCards.length===0;
      // Independent real first-ten evidence at HEAD ec785ee5: AliExpress
      // Spanish phone-compatible chargers/adapters previously ranked as
      // complete iPhones. Detect this P0 regardless of earlier CI greens.
      const spanishAccessoryCards=report.firstTenGroups.filter(group=>
        /^\s*(?:adaptador(?:es)?|cargador(?:es)?|convertidor(?:es)?)\b/i.test(group.title||''));
      const untraceableAliExpress=report.firstTenGroups.filter(group=>
        (group.offerSourcePaths||[]).some(url=>
          /^https:\/\/(?:www\.)?aliexpress\.com\/ssr\//i.test(url)));
      report.iphoneSpanishAccessoryTrust={
        query,spanishAccessoryTitles:spanishAccessoryCards.map(g=>g.title),
        genericLandingPageTitles:untraceableAliExpress.map(g=>g.title),
        assessment:'captured_merchant_title_and_source_path_first_ten_no_price_verification'
      };
      report.assertions.noSpanishAccessoryAsIphone=spanishAccessoryCards.length===0;
      report.assertions.noAliExpressGenericLandingAsExactIphone=untraceableAliExpress.length===0;
      const compatibilityOnlyPhoneCards=report.firstTenGroups.filter(group=>{
        const name=String(group.title||'');
        return /\b(?:for|compatible with|fits)\s+(?:apple\s+)?iphone\s+\d+\b/i.test(name) &&
          !/^\s*(?:(?:genuine|original|refurbished|renewed|used|new)\s+)?(?:apple\s+)?iphone\s+\d+\b/i.test(name);
      });
      report.iphoneCompatibilityOnlyProductTrust={
        query,compatibleAccessoryTitles:compatibilityOnlyPhoneCards.map(g=>g.title),
        evidenceScope:'real_first_ten_title_subject_not_independent_PDP_checkout'
      };
      report.assertions.noCompatibilityOnlyAccessoryAsIphone=compatibilityOnlyPhoneCards.length===0;
    }
    // Real customer smoke: HP computer searches must not surface sleeve, bag or
    // sling accessories as laptop product cards. Explicit accessory searches
    // remain a separate, permitted intent. This is a targeted guard, NOT an
    // independently labeled universal product-precision metric.
    if(query==='HP laptop'||query==='لابتوب اتش بي'){
      // Broader independently identified item types from the real Arabic
      // Chromium output: fans, LCD replacements, screen privacy filters,
      // compatible protective shells, stylus pens, sleeves and laptop luggage.
      const accessoryTitles=report.firstTenGroups.filter(group=>{
        const title=group.title.toLowerCase();
        // Source-grounded real Chromium safeguard: a leading "Compatible
        // with HP" third-party keyboard cover was title-clipped before the
        // word "Cover" and erroneously passed the former keyboard-only guard.
        const hpClaim=title.match(/\bcompatible with (?:hp|hewlett packard)\b/);
        if(hpClaim && !/\b(?:laptops?|notebooks?|chromebooks?|macbooks?|computers?|desktops?|pcs?|pavilion|elitebook|probook|spectre|envy|omnibook|victus|omen)\b/.test(title.slice(0,hpClaim.index)))return true;
        // Real first-ten candidate evidence: laptop batteries and external
        // power supplies were missed by the older sleeve/fan-only guard.
        if(/\b(?:laptop|notebook) batter(?:y|ies)\b|\bbatter(?:y|ies) (?:replacement|compatible|for)\b|\bpower suppl(?:y|ies)\b/.test(title)) return true;
        if(/\b(?:sleeves?|slings?|briefcases?|rucksacks?|backpacks?|laptop bags?|laptop cases?|laptop pouches?|(?:cpu |laptop |notebook )?(?:cooling|replacement) fans?|cpu fans?|protective shells?|privacy screens?|active pens?|(?:lcd|led lcd|screen) replacements?|only compatible with)\b/i.test(title))return true;
        const peripheral=title.search(/\b(?:keyboards?|mice|mouse)\b/);
        if(peripheral<0)return false;
        const machine=title.search(/\b(?:laptop|notebook|chromebook|macbook)\b/);
        return machine<0||peripheral<machine||
          !/\b(?:with|includes|including|bundle)\b/.test(title.slice(machine,peripheral));
      });
      const sparseUnknown=report.firstTenGroups.filter(group=>
        /^hp (?:everyday |business |standard )?(?:laptop|notebook)$/i.test(group.title.trim()));
      const computers=report.firstTenGroups.filter(group=>
        /\b(?:pavilion|elitebook|probook|spectre|envy|omnibook|victus|omen|laptops?|notebooks?|chromebooks?)\b/i.test(group.title) &&
        !accessoryTitles.includes(group)&&!sparseUnknown.includes(group));
      report.hpLaptopDeviceIntegrity={
        query,groupsInspected:report.firstTenGroups.length,
        knownAccessories:accessoryTitles.map(group=>group.title),
        sparseUnverifiedTitles:sparseUnknown.map(group=>group.title),
        apparentComputers:computers.length,
        assessment:'targeted_self_reviewed_name_guard_not_independently_certified_product_precision',
      };
      report.assertions.hpLaptopNoCarryAccessories=accessoryTitles.length===0;
      report.assertions.hpLaptopNoSparseUnverifiedCards=sparseUnknown.length===0;
      report.assertions.hpLaptopHasComputerResult=computers.length>0;
    }
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
      pendingWithoutFallback:details.filter(x=>x.state==='pending'&&!x.fallbackVisible).length,
      loadedWithFallback:details.filter(x=>x.state==='loaded'&&x.fallbackVisible).length,
      noImageWithoutFallback:details.filter(x=>x.state==='no-image'&&!x.fallbackVisible).length};
  });
  report.imageQA=imageQA;
  report.assertions.imageFallbackSafe=imageQA.brokenWithoutFallback===0&&
    imageQA.pendingWithoutFallback===0&&imageQA.loadedWithFallback===0&&
    imageQA.noImageWithoutFallback===0;
  // Run the production browser module itself against a simulated replay and
  // a forged badge grant. The currently issued server context is intentionally
  // WITHHELD: no positive customer VERIFIED UI is authorized by this test.
  const trustBrowser=await page.evaluate(async()=>{
    const {acceptDisplayTrustContext}=await import('/src/search-stream.mjs');
    const id='12345678-1234-4abc-8123-123456789abc';
    const envelope={streamGeneration:id,displayTrustContext:{
      policy:'display-snapshot-v1',scope:'stream_snapshot_not_sellable_offer',
      streamGeneration:id,snapshotRevision:1,customerVerified:false,badgeEligible:false
    }};
    return {
      normal:acceptDisplayTrustContext(id,envelope)?.badgeEligible===false,
      replay:acceptDisplayTrustContext(id,envelope,1)===null,
      forged:acceptDisplayTrustContext(id,{...envelope,
        displayTrustContext:{...envelope.displayTrustContext,badgeEligible:true}})===null,
      visibleVerifiedElements:document.querySelectorAll(
        '[data-trust-verified="true"],.trust-badge-verified').length
    };
  });
  report.trustBrowser=trustBrowser;
  report.assertions.v2169DisplayTrustFailClosed=
    trustBrowser.normal&&trustBrowser.replay&&trustBrowser.forged&&
    trustBrowser.visibleVerifiedElements===0;
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
