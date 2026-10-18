// Run the CANDIDATE server locally on the GitHub runner against real, public
// merchant endpoints. This tests product search wiring without deploying Render.
// No database/Meili credentials, writes, or production activation.
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import {searchViaConstructor} from '../server/providers/jarir.mjs';
import {assessOfferMatch,describeProduct} from '../src/search-query.mjs';

const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();
  s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>{
    const p=s.address().port;
    s.close(()=>resolve(p));
  });
});
const env={
  ...process.env,PORT:String(port),DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:'',
  NOON_ENABLED:'false',CARREFOUR_ENABLED:'false',EBAY_ENABLED:'false',
  SEARCH_REQUEST_DEADLINE_MS:'12000',
};
const child=spawn(process.execPath,['server/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
let out='',err='';
child.stdout.on('data',chunk=>{out=(out+chunk).slice(-2000)});
child.stderr.on('data',chunk=>{err=(err+chunk).slice(-2000)});
const base='http://127.0.0.1:'+port;
async function waitForHealth(){
  for(let i=0;i<55;i++){
    if(child.exitCode!==null)throw Error('candidate_server_exited:'+child.exitCode);
    try{
      const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});
      if(r.status===200)return;
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error('candidate_health_timeout:'+err.slice(0,250));
}
async function query(text){
  const start=Date.now();
  try{
    const r=await fetch(base+'/api/search?q='+encodeURIComponent(text),{
      headers:{accept:'application/json'},signal:AbortSignal.timeout(32000),
    });
    const data=await r.json();
    const offers=Array.isArray(data.offers)?data.offers:[];
    const exact=offers.filter(x=>x.exactMatch===true);
    const structurallyValid=offers.filter(o=>{
      try{
        return typeof o.title==='string' && o.title.trim().length>0 &&
          Number.isFinite(o.productPrice) && o.productPrice>0 &&
          o.currency==='SAR' && typeof o.merchant==='string' && o.merchant.trim() &&
          new URL(o.sourceUrl).protocol==='https:';
      }catch{return false}
    });
    const falsePS5=exact.filter(o=>/\b(?:disc|disk|optical|blu ray)\s+drive\b/i.test(o.title||'') &&
      !/\bconsole\b.*\b(?:with|includes?|including)\b/i.test(o.title||''));
    const result={
      q:text,status:r.status,elapsedMs:Date.now()-start,
      count:offers.length,exact:exact.length,structurallyValid:structurallyValid.length,
      merchants:[...new Set(offers.map(o=>o.merchant).filter(Boolean))].slice(0,15),
      providerSummary:(data.providers||[]).filter(p=>(p.returnedOffers||0)>0).map(p=>({sourceId:p.sourceId,offers:p.returnedOffers})),
      failures:(data.errors||[]).slice(0,7).map(e=>({id:e.sourceId,code:String(e.error||e.message||'').slice(0,110)})),
      falsePS5: falsePS5.map(o=>({title:o.title,price:o.productPrice})),
    };
    console.log('CANDIDATE_LIVE_SEARCH '+JSON.stringify(result));
    return result;
  }catch(error){
    const result={q:text,status:null,elapsedMs:Date.now()-start,error:String(error?.message||error).slice(0,200)};
    console.log('CANDIDATE_LIVE_SEARCH '+JSON.stringify(result));
    return result;
  }
}
async function measureStreamFirstOffer(text){
  const start=Date.now();
  let firstOfferMs=null;
  let firstMerchantCount=0;
  let finalOfferCount=0;
  let done=false;
  let snapshots=0;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new Error('sse_diagnostic_timeout')),25000);
  try{
    const r=await fetch(base+'/api/search/stream?q='+encodeURIComponent(text),{
      headers:{accept:'text/event-stream'},signal:controller.signal,
    });
    if(r.status!==200)throw Error('sse_status_'+r.status);
    const reader=r.body.getReader();
    const decoder=new TextDecoder();
    let remaining='';
    while(true){
      const {value,done:streamDone}=await reader.read();
      if(streamDone)break;
      remaining+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
      // Prevent a malformed server from accumulating an unbounded line buffer.
      if(remaining.length>2000000)throw Error('sse_buffer_limit');
      let end;
      while((end=remaining.indexOf('\n\n'))!==-1){
        const block=remaining.slice(0,end);
        remaining=remaining.slice(end+2);
        const event=block.match(/^event: (.+)$/m)?.[1];
        const data=block.match(/^data: (.+)$/m)?.[1];
        if(event==='snapshot'&&data){
          snapshots++;
          const parsed=JSON.parse(data);
          const offers=Array.isArray(parsed.offers)?parsed.offers:[];
          if(firstOfferMs===null&&offers.length){
            firstOfferMs=Date.now()-start;
            firstMerchantCount=new Set(offers.map(o=>o.merchant).filter(Boolean)).size;
          }
          finalOfferCount=offers.length;
        }
        if(event==='done'){done=true;break}
      }
      if(done)break;
    }
    const measurement={
      q:text,sseStatus:r.status,firstOfferMs,firstMerchants:firstMerchantCount,
      snapshots,finalOffers:finalOfferCount,finishedMs:Date.now()-start,done,
    };
    console.log('CANDIDATE_SSE_TIMING '+JSON.stringify(measurement));
    return measurement;
  } catch(error){
    const measurement={q:text,error:String(error?.message||error).slice(0,180),firstOfferMs,
      elapsedMs:Date.now()-start};
    console.log('CANDIDATE_SSE_TIMING '+JSON.stringify(measurement));
    return measurement;
  }finally{clearTimeout(timeout);controller.abort()}
}
try{
  await waitForHealth();
  // Cold-stream timing must run BEFORE the JSON search for the same query;
  // otherwise cachedSearch returns a warm snapshot and masks real first-offer delay.
  const stream=await measureStreamFirstOffer('iPhone 17');
  const iphone=await query('iPhone 17');
  const ps5=await query('PS5');
  // v15.14: bounded read-only real Constructor search and raw vs adapter
  // evidence. This is diagnostic-only (no provider, product or DB writes).
  // Intercept existing PUBLIC adapter fetch rather than guessing new endpoints
  // or duplicating the storefront's public Constructor key.
  const targets=new Set(['668751','677771']);
  const probeQueries=[
    {query:'677771',limit:12},
    {query:'CFI2116BCFIZC',limit:12},
    {query:'PS5 DualSense Bundle',limit:24},
    {query:'Sony PlayStation 5 Slim DIG',limit:24},
    {query:'Sony PlayStation 5 Slim',limit:48},
  ];
  const pickMetadata=meta=>{
    const keys=['name','model','seri','ptyp','productcode_description',
      'mpn','item_number','tsca','colo','cofa','brand','price',
      'bundle','subtitle','sub_title','description','product_description'];
    const fields={};
    for(const key of keys){
      const value=meta?.[key];
      if(['string','number','boolean'].includes(typeof value))
        fields[key]=String(value).slice(0,320);
    }
    return {keys:Object.keys(meta||{}).sort().slice(0,100),fields};
  };
  const extractRaw=raw=>({
    id:String(raw?.data?.id||''),sku:String(raw?.data?.sku||''),
    value:String(raw?.value||'').slice(0,320),
    description:String(raw?.data?.description||'').slice(0,320),
    url:String(raw?.data?.url||'').slice(0,320),
    price:raw?.data?.price??null,
    metadata:pickMetadata(raw?.data?.metadata||{}),
  });
  const originalFetch=globalThis.fetch;
  const rawEvidence=[];
  // Diagnostic instrumentation exists ONLY in this disposable GitHub runner
  // process, never in the child server or the production Jarir adapter.
  globalThis.fetch=async(input,init)=>{
    const response=await originalFetch(input,init);
    try{
      const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input?.url);
      if(u.hostname==='ac.cnstrc.com'&&u.pathname.startsWith('/v1/search/')&&response.ok){
        const length=Number(response.headers.get('content-length')||0);
        if(!length||length<=2_000_000){
          const body=await response.clone().text();
          if(body.length<=2_000_000){
            const parsed=JSON.parse(body);
            for(const raw of parsed?.response?.results||[]){
              const id=String(raw?.data?.id||raw?.data?.sku||'');
              if(targets.has(id))rawEvidence.push({
                query:u.pathname.slice('/v1/search/'.length),
                captureTime:new Date().toISOString(),
                raw:extractRaw(raw),
              });
            }
          }
        }
      }
    }catch(error){
      console.log('JARIR_V1514_CAPTURE_WARNING '+JSON.stringify({
        reason:String(error?.message||error).slice(0,120)}));
    }
    return response;
  };
  try{
    for(const {query,limit} of probeQueries){
      let found=[],error=null;
      try{
        found=await searchViaConstructor(query,limit,AbortSignal.timeout(8000));
      }catch(e){error=String(e?.message||e).slice(0,160)}
      const normalized=found.filter(o=>targets.has(String(o.sourceMeta?.productId||'')))
        .map(o=>({
          id:String(o.sourceMeta?.productId||''),
          title:o.title,sourceUrl:o.sourceUrl,
          productPrice:o.productPrice,currency:o.currency,observedAt:o.observedAt,
          specs:{deviceType:o.specs?.deviceType||null,series:o.specs?.series||null,
            modelNumber:o.specs?.modelNumber||null,storage:o.specs?.storage||null},
          sourceMeta:{productType:o.sourceMeta?.productType||null,
            parsedFrom:o.sourceMeta?.parsedFrom||null},
          kind:describeProduct(o).kind,isBundle:describeProduct(o).isBundle,
          exactPS5:assessOfferMatch('PS5',o).exactMatch,
          exactPS5SSD:assessOfferMatch('PS5 SSD',o).exactMatch,
        }));
      const rawForQuery=rawEvidence.filter(x=>decodeURIComponent(x.query)===query);
      const observed=normalized.some(x=>x.id==='677771')||
        rawForQuery.some(x=>x.raw.id==='677771');
      const status=error?'SOURCE_UNAVAILABLE':observed?'OBSERVED':'NOT_IN_BOUNDED_RESULTS';
      console.log('JARIR_V1514_RAW_VS_ADAPTER '+JSON.stringify({
        query,limit,returned:found.length,status,
        raw:rawForQuery,normalized,error,
        evidenceLevel:observed?'E1-live-Constructor':'E1-bounded-negative-observation',
        note:'captureTime and observedAt are acquisition timestamps; neither is merchant listing update time',
      }));
      // Only an actual returned, normalized product can fail a customer
      // certification. Missing SKU remains UNKNOWN, not a failed listing.
      const conflicts=normalized.filter(x=>x.id==='677771'&&
        (x.kind!=='console'||!x.exactPS5||x.exactPS5SSD));
      if(conflicts.length)process.exitCode=7;
    }
  }finally{globalThis.fetch=originalFetch}
  // v15.15: bounded diagnostic-only public catalog recovery probe. No provider
  // mutation, new endpoint, database write, or assertion that the item is on sale.
  // Use existing public-page resolver, 1 request/second minimum and bounded URLs.
  const {fetchHtmlSafe,resolveProductUrl}=await import('../server/url-resolver.mjs');
  const {parseJarirSearchHtml}=await import('../server/providers/jarir.mjs');
  const {load:cheerioLoad}=await import('cheerio');
  const jarirCatalogTargets=[
    {sku:'677770',model:'CFI2116ACFIZC',edition:'disc',url:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-677770.html'},
    {sku:'677771',model:'CFI2116BCFIZC',edition:'digital',url:'https://www.jarir.com/sa-en/sony-playstation-5-slim-dig-gaming-consoles-and-handheld-677771.html'},
  ];
  const categoryUrl='https://www.jarir.com/sa-en/sony-ps5-consoles-4518-x.html';
  let lastJarirRequest=0;
  async function paceJarir(){
    const wait=Math.max(0,1100-(Date.now()-lastJarirRequest));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    lastJarirRequest=Date.now();
  }
  await paceJarir();
  try{
    const {html,finalUrl}=await fetchHtmlSafe(categoryUrl,0,{signal:AbortSignal.timeout(14000)});
    // v15.16: read-only forensic DOM inspection of the ONE already fetched,
    // public category page. No further network access or full HTML dump.
    const $=cheerioLoad(html);
    const tiles=$('div.product-tile__item--spacer');
    const compact=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,600);
    const tileEvidence=tiles.toArray().slice(0,12).map((node,i)=>{
      const el=$(node),parent=el.parent(),grand=parent.parent();
      const tags=[el,parent,grand].map(x=>({
        tag:x.get(0)?.tagName||null,
        classes:compact(x.attr('class')).slice(0,130),
        dataAttrs:Object.fromEntries(Object.entries(x.attr()||{})
          .filter(([k])=>k.startsWith('data-') && !/token|key|auth|session|cookie/i.test(k))
          .slice(0,15).map(([k,v])=>[k,compact(v).slice(0,160)])),
      }));
      const near=grand.find('[data-cnstrc-item-id],[data-product-id],[data-sku],[itemprop="price"],a[href*="-gaming-consoles-"],a[href*="sony-playstation-5"]');
      const attrs=near.toArray().slice(0,8).map(n=>{
        const e=$(n),a=e.attr()||{};
        return {tag:n.tagName,attr:Object.fromEntries(Object.entries(a)
          .filter(([k])=>/^(?:data-(?:cnstrc-item-(?:id|name|price)|product-id|sku)|href|itemprop|content|class)$/i.test(k))
          .slice(0,7).map(([k,v])=>[k,compact(v).slice(0,180)])),text:compact(e.text()).slice(0,130)}
      });
      return {i,tags,near:attrs,grandText:compact(grand.text()).slice(0,300)};
    });
    const skuEvidence=Object.fromEntries(['668751','677770','677771'].map(id=>{
      const m=[...html.matchAll(new RegExp('(?<![0-9])'+id+'(?![0-9])','g'))].slice(0,10);
      return [id,{occurrences:m.length,locations:m.map(x=>({
        offset:x.index,context:compact(html.slice(Math.max(0,x.index-200),x.index+200))
          .replace(/https?:\/\/[^\s"'<>]+/g,'[URL]')
      }))}];
    }));
    console.log('JARIR_V1516_CATEGORY_DOM '+JSON.stringify({
      totalTiles:tiles.length,
      productMarkerElements:$('[data-cnstrc-item-id]').length,
      itemPropPrices:$('[itemprop="price"]').length,
      jsonLdScripts:$('script[type="application/ld+json"]').length,
      tileEvidence,skuEvidence
    }));

    const schemaProducts=[];
    for(const node of $('script[type="application/ld+json"]').toArray()){
      try{
        const data=JSON.parse($(node).html());
        for(const root of (Array.isArray(data)?data:[data])){
          const lists=[root,...(Array.isArray(root?.['@graph'])?root['@graph']:[])];
          for(const list of lists){
            for(const entry of list?.itemListElement||[]){
              const p=entry?.item||entry;
              const offer=Array.isArray(p?.offers)?p.offers[0]:p?.offers||{};
              if(String(p?.['@type']||'').toLowerCase()!=='product')continue;
              schemaProducts.push({
                sku:String(p?.sku||''),name:String(p?.name||'').slice(0,150),
                model:p?.model||null,mpn:p?.mpn||null,
                price:offer?.price??null,currency:offer?.priceCurrency??null,
                availability:offer?.availability??null,
                url:p?.url||null,imagePresent:Boolean(p?.image),
                seller:offer?.seller?.name||null,
              });
            }
          }
        }
      }catch(e){console.log('JARIR_V1516_SCHEMA_ERROR '+String(e.message).slice(0,90))}
    }
    const visibleTiles=$('a.product-tile__link[data-product-id]').toArray().map(n=>{
      const a=$(n);return {sku:a.attr('data-product-id'),href:a.attr('href'),
        text:compact(a.text()).slice(0,140)};
    });
    console.log('JARIR_V1516_SCHEMA_CATALOG '+JSON.stringify({
      schemaCount:schemaProducts.length,schemaProducts,
      visibleTiles,visibleSkuCount:visibleTiles.length,
      schemaNotVisible:schemaProducts.filter(p=>!visibleTiles.some(t=>t.sku===p.sku)).map(p=>p.sku)
    }));
    const parsed=parseJarirSearchHtml(html,48);
    const rows=parsed.filter(row=>['668751','677770','677771'].includes(String(row.sourceMeta?.productId||'')))
      .map(row=>({sku:row.sourceMeta.productId,title:row.title,price:row.productPrice,
        currency:row.currency,sourceUrl:row.sourceUrl,imagePresent:Boolean(row.image),
        observedAt:row.observedAt}));
    console.log('JARIR_V1515_PUBLIC_CATEGORY '+JSON.stringify({
      url:categoryUrl,finalUrl,htmlBytes:Buffer.byteLength(html),
      tileMarkerCount:(html.match(/product-tile__item--spacer/g)||[]).length,
      parsed:parsed.length,targets:rows,
      rawSkuMarkers:Object.fromEntries(['668751','677770','677771'].map(id=>[
        id,new RegExp('(?<![0-9])'+id+'(?![0-9])','g').test(html)
      ])),
      evidence:'read-only public HTML, not proof of Constructor membership'
    }));
  }catch(error){
    console.log('JARIR_V1515_PUBLIC_CATEGORY '+JSON.stringify({
      url:categoryUrl,status:'UNAVAILABLE_OR_UNPARSEABLE',
      error:String(error?.message||error).slice(0,180)
    }));
  }

  // Compare EXISTING compliant HTML search fallback with official category
  // structure and 1 bounded Constructor query; fail-closed if blocked.
  await paceJarir();
  try{
    const url='https://www.jarir.com/sa-en/catalogsearch/result/?q=PS5';
    const {html}=await fetchHtmlSafe(url,0,{signal:AbortSignal.timeout(14000)});
    const found=parseJarirSearchHtml(html,48);
    const $s=cheerioLoad(html);
    console.log('JARIR_V1516_SEARCH_HTML '+JSON.stringify({
      url,bytes:Buffer.byteLength(html),
      categoryTiles:$s('div.product-tile__item--spacer').length,
      productLinks:$s('a.product-tile__link[data-product-id]').length,
      jsonLd:$s('script[type="application/ld+json"]').length,
      parsed:found.length,firstSkus:$s('a.product-tile__link[data-product-id]').toArray().slice(0,15)
        .map(n=>$s(n).attr('data-product-id'))}));
  }catch(error){
    console.log('JARIR_V1516_SEARCH_HTML '+JSON.stringify({
      status:'UNAVAILABLE',error:String(error.message||error).slice(0,140)}));
  }
  await paceJarir();
  try{
    const found=await searchViaConstructor('PS5',96,AbortSignal.timeout(8500));
    const ids=new Set(found.map(o=>String(o.sourceMeta?.productId||'')));
    console.log('JARIR_V1516_CONSTRUCTOR_CATEGORY_COMPARISON '+JSON.stringify({
      query:'PS5',returned:found.length,
      targetResults:Object.fromEntries(['668751','677770','677771','627671','627678','670688']
        .map(id=>[id,ids.has(id)])),
      observedIds:[...ids].slice(0,96)}));
  }catch(error){
    console.log('JARIR_V1516_CONSTRUCTOR_CATEGORY_COMPARISON '+JSON.stringify({
      status:'UNAVAILABLE',error:String(error.message||error).slice(0,140)}));
  }
  for(const target of jarirCatalogTargets){
    await paceJarir();
    try{
      // A resolved page is not accepted without verifiable product identity,
      // source URL, price/currency and physical package description.
      const page=await resolveProductUrl(target.url,{signal:AbortSignal.timeout(14000)});
      const pageSku=String(page.sku||'');
      const returnedUrl=page.resolvedPageUrl||page.sourceUrl||'';
      const skuInUrl=returnedUrl.includes('-'+target.sku+'.html');
      const model=String(page.specs?.modelNumber||'');
      const kind=describeProduct(page);
      const crediblePrice=Number.isFinite(page.productPrice)&&page.productPrice>0&&
        page.currency==='SAR'&&page.originalCurrency==='SAR';
      const identitySupported=(pageSku===target.sku||skuInUrl)&&
        (!model||model===target.model)&&kind.kind==='console'&&kind.isBundle===true;
      console.log('JARIR_V1515_PUBLIC_PDP '+JSON.stringify({
        requestedSku:target.sku,requestedEdition:target.edition,
        requestedUrl:target.url,pageSku:pageSku||null,
        manufacturerModel:model||null,returnedUrl,title:page.title,
        productKind:kind.kind,isBundle:kind.isBundle,
        price:crediblePrice?page.productPrice:null,
        currency:crediblePrice?page.currency:null,
        imagePresent:Boolean(page.image),availability:page.availability,
        observedAt:page.observedAt,
        status:identitySupported&&crediblePrice?'PDP_RESOLVER_VERIFIED':'INCOMPLETE_OR_IDENTITY_UNVERIFIED',
        note:'acquisition observation only; no confirmed stock or future price guarantee'
      }));
    }catch(error){
      console.log('JARIR_V1515_PUBLIC_PDP '+JSON.stringify({
        requestedSku:target.sku,requestedUrl:target.url,
        status:'UNAVAILABLE_OR_UNPARSEABLE',
        error:String(error?.message||error).slice(0,180)
      }));
    }
  }
  if(iphone.status!==200||ps5.status!==200)process.exitCode=2;
  // HTTP 200 + empty products is not a functional search success.
  if([iphone,ps5].some(x=>!x.structurallyValid || x.exact<1 || x.merchants.length<2))
    process.exitCode=5;
  if([iphone,ps5].some(x=>x.merchants.includes('App')))
    process.exitCode=6;
  if(ps5.falsePS5?.length)process.exitCode=3;
  if(stream.sseStatus!==200||!stream.done||stream.firstOfferMs===null)process.exitCode=4;
}finally{
  if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);
}
