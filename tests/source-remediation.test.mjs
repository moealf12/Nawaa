import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import {searchJarir,parseJarirSearchHtml,parseJarirConstructorPayload} from '../server/providers/jarir.mjs';
import {searchExtraUnbxd} from '../server/providers/extra-unbxd.mjs';
import {searchFreeStorefrontById,routeFreeStorefronts,extractBestBuySearchOffers} from '../server/providers/free-storefronts.mjs';
import {auditSource} from '../server/audit-contract.mjs';

const jarirItem=(title,id='1')=>({value:title,data:{id,url:`product-${id}.html`,price:3000,metadata:{}}});
const extraItem=(title,id='1',storage=null)=>({id,name:title,currentPrice:3000,available:true,featureEnMemoryInternal:storage});
async function withFetch(fetcher,run){const old=globalThis.fetch,oldLookup=dns.lookup;try{globalThis.fetch=fetcher;dns.lookup=async()=>[{address:'93.184.216.34',family:4}];return await run();}finally{globalThis.fetch=old;dns.lookup=oldLookup;}}

test('Jarir extraction strategies retain canonical attribution accepted by the source audit',async()=>{
  const constructor=parseJarirConstructorPayload({response:{results:[jarirItem('Apple iPhone 17 256GB')]}});
  const html=parseJarirSearchHtml('<div class="product-tile__item--spacer" data-cnstrc-item-id="1" data-cnstrc-item-name="Apple iPhone 17 256GB" data-cnstrc-item-price="3000"><a href="https://www.jarir.com/sa-en/product-1.html" data-product-id="1"></a></div>');
  for(const offers of [constructor,html]){
    const report=await auditSource({source:{id:'jarir',name:'Jarir',adapter:'jarir-direct',status:'configured'},query:'iPhone 17 256GB',search:async()=>({offers,errors:[]})});
    assert.equal(report.status,'VALID_CATALOG_SAMPLE');
    assert.equal(offers[0].provider,'jarir-direct');
    assert.ok(offers[0].sourceMeta.parsedFrom);
  }
});
test('successful empty Jarir Constructor search never returns HTML recommendations',async()=>{
  await withFetch(async url=>{
    if(String(url).startsWith('https://ac.cnstrc.com/')) return Response.json({response:{results:[]}});
    throw new Error('HTML recommendation fallback should not run');
  },async()=>{
    const r=await searchJarir('nawaa-unfindable-943271');
    assert.deepEqual(r.offers,[]);assert.deepEqual(r.errors,[]);
  });
});
test('Jarir retains and classifies variants instead of dropping discovered results',async()=>{
  await withFetch(async url=>String(url).startsWith('https://ac.cnstrc.com/')?Response.json({response:{results:[jarirItem('Apple iPhone 17 256GB','1'),jarirItem('Apple iPhone 17 Pro 256GB','2'),jarirItem('Apple iPhone 17 512GB','3')]}}):new Response(`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Apple iPhone 17 256GB',offers:{price:3000,priceCurrency:'SAR',url:String(url)}})}</script>`,{headers:{'content-type':'text/html'}}),async()=>{
    const r=await searchJarir('ايفون ١٧ ٢٥٦ جيجا');
    assert.deepEqual(r.offers.map(x=>x.sourceMeta.productId),['1','2','3']);
    assert.equal(r.diagnostics.acquisition.discovered,3);
    assert.equal(r.diagnostics.acquisition.classified,3);
    assert.equal(r.diagnostics.acquisition.dropped,0);
    assert.equal(r.offers[0].exactMatch,true);
  });
});
test('Jarir malformed payload and failed fallback cannot pass a negative control',async()=>{
  await withFetch(async url=>String(url).startsWith('https://ac.cnstrc.com/')?Response.json({response:{error:'Bad schema'}}):new Response('',{status:503}),async()=>{
    const r=await auditSource({source:{id:'jarir',name:'Jarir',adapter:'jarir-direct',status:'configured'},query:'nawaa-unfindable-943271',expected:'empty',search:searchJarir});
    assert.equal(r.status,'FETCH_FAILED');assert.ok(r.errorCodes.length);
  });
});
test('eXtra excludes conflicting capacity metadata, variants and accessories while retaining explicit RAM',async()=>{
  const products=[extraItem('Apple iPhone 17 256GB 8GB RAM','1','256 GB'),extraItem('Apple iPhone 17 Pro 256GB','2'),extraItem('Apple iPhone 17 256GB','3','512GB'),extraItem('Case for Apple iPhone 17 256GB','4')];
  await withFetch(async()=>Response.json({response:{products}}),async()=>{
    const r=await searchExtraUnbxd('iPhone 17 256GB');assert.deepEqual(r.offers.map(x=>x.sourceMeta.productId),['1']);
    assert.deepEqual(r.diagnostics.queryFilter,{input:4,retained:1,removed:3});
  });
});
test('eXtra brand discovery keeps new matching categories and removes unrelated brands',async()=>{
  await withFetch(async()=>Response.json({response:{products:[extraItem('HP ProBook Laptop','1'),extraItem('HP LaserJet Printer','2'),extraItem('Dell Laptop','3')]}}),async()=>{
    const r=await searchExtraUnbxd('اتش بي');assert.deepEqual(r.offers.map(x=>x.sourceMeta.productId),['1','2']);
  });
});
test('NiceOne resolved page output removes perfume accessories rather than surfacing them as perfume',async()=>{
  const oldLookup=dns.lookup;
  dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
  try {await withFetch(async url=>{
    if(String(url).includes('/search?')) return new Response('<a href="https://niceonesa.com/en/perfume-n1">Perfume</a><a href="https://niceonesa.com/en/bottle-n2">Bottle</a>',{headers:{'content-type':'text/html'}});
    const bottle=String(url).includes('bottle');
    return new Response(`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:bottle?'Empty Perfume Bottle Atomizer':'Niceone Musk Eau De Perfume',offers:{price:100,priceCurrency:'SAR',url:String(url)}})}</script>`,{headers:{'content-type':'text/html'}});
  },async()=>{
    const r=await searchFreeStorefrontById('niceone-sa','perfume',{perStore:10});
    assert.deepEqual(r.offers.map(x=>x.title),['Niceone Musk Eau De Perfume']);
    assert.deepEqual(r.diagnostics.queryFilter,{input:2,retained:1,removed:1});
  });}finally{dns.lookup=oldLookup;}
});


test('Amazon Saudi participates as a broad local marketplace',()=>{
 const routes=routeFreeStorefronts('HP',Infinity);
 const amazon=routes.find(x=>x.store.id==='amazon-sa');
 assert.ok(amazon);
 assert.equal(amazon.store.countryCode,'SA');
 assert.ok(amazon.reasons.includes('general_marketplace'));
});


test('Virgin Saudi is routed in the first acquisition wave for audio searches',()=>{
  const routes=routeFreeStorefronts('AirPods',16,{stable:true});
  const virgin=routes.find(x=>x.store.id==='virgin-sa');
  assert.ok(virgin,'Virgin Saudi should be searched on the initial AirPods request');
  assert.equal(virgin.store.countryCode,'SA');
  assert.ok(virgin.reasons.includes('category'));
});


test('Virgin Megastore UAE PDP adapter extracts AED price and numeric product id',async()=>{
  const html='<html><head><meta property="og:title" content="Apple AirPods 4 with ANC"><meta property="og:image" content="https://virgin.example/airpods.jpg"></head><body><main><h1>Apple AirPods 4 with ANC</h1><div class="price">AED 749.00</div></main></body></html>';
  const {extractDomainProduct}=await import('../server/domain-adapters.mjs');
  const extracted=extractDomainProduct('https://www.virginmegastore.ae/en/electronics-accessories/apple/airpods-earpods/apple-airpods-4-with-active-noise-cancellation/p/123456',html);
  assert.equal(extracted?.adapterId,'virginmegastore');
  assert.equal(extracted?.product?.offers?.price,749);
  assert.equal(extracted?.product?.offers?.priceCurrency,'AED');
  assert.equal(extracted?.product?.sku,'123456');
  assert.match(extracted?.product?.name || '',/AirPods 4/i);
});


test('v21.28 RED real source-link identity: Best Buy console SKU cannot be titled as a standalone PS5 disc drive',()=>{
  // REAL customer browser evidence: v21.28 exact-HEAD Chromium run
  // #39691222285 surfaced a standalone Disc Drive TITLE with Best Buy
  // source URL SKU 6646419. Official PDP is a PS5 Slim Console 1TB
  // (Best Buy model 1000049888); title/source identity conflict is P0.
  // Fixture is synthetic MINIMAL hydration ordering, not original HTML.
  const consolePdp='https://www.bestbuy.com/product/playstation-5-slim-console-1tb/JXHQ37TYLC/sku/6646419';
  const bad=['{"price":{"customerPrice":649.99},"skuId":"6646419",',
    '"pdpUrl":"'+consolePdp+'",',
    '"name":{"short":"PlayStation 5 Slim Console – 1TB"},',
    // A different product name follows nearby in the broad ±16K scan.
    '"name":{"short":"Sony Interactive Entertainment - Disc Drive For PS5 Digital Edition Consoles"}}'
  ].join('');
  const out=extractBestBuySearchOffers(bad,'PS5 disc drive');
  assert.equal(out.some(x=>x.sourceUrl===consolePdp&&/disc drive/i.test(x.title)),false,
    'never pair a standalone disc-drive title with a console PDP/SKU');
  // A real standalone add-on DRIVE title and matching descriptive PDP URL
  // must remain retrievable, not blindly blacklist Best Buy results.
  const valid=['{"price":{"customerPrice":79.99},"skuId":"882200",',
    '"pdpUrl":"https://www.bestbuy.com/product/sony-disc-drive-for-ps5-slim/XTEST/sku/882200",',
    '"name":{"short":"Sony Disc Drive for PS5 Slim Digital Edition"}}'].join('');
  const good=extractBestBuySearchOffers(valid,'PS5 disc drive');
  assert.equal(good.length,1,'valid independently named accessory must survive');
  assert.equal(good[0].productId,'882200');
});


test('v21.29 RED: Best Buy neighboring same-category records cannot exchange title or image ownership',()=> {
  // Synthetic minimized product-object adjacency: both titles describe phones, so
  // the v21.28 console/accessory category guard cannot detect this contamination.
  const rows=[
    {price:{customerPrice:999.99},skuId:"760001",pdpUrl:"https://www.bestbuy.com/product/apple-iphone-17-pro-256gb/P17PRO/sku/760001",name:{short:"Apple iPhone 17 Pro 256GB"},primaryImage:{piscesHref:"https://images.bestbuy.com/pro-256.jpg"}},
    {price:{customerPrice:1299.99},skuId:"760002",pdpUrl:"https://www.bestbuy.com/product/apple-iphone-17-pro-max-512gb/P17MAX/sku/760002",name:{short:"Apple iPhone 17 Pro Max 512GB"},primaryImage:{piscesHref:"https://images.bestbuy.com/max-512.jpg"}}
  ];
  for(const ordered of [rows,[...rows].reverse()]){
    const offers=extractBestBuySearchOffers(JSON.stringify({products:ordered}),"iPhone 17 Pro");
    assert.equal(offers.length,2,"preserve both legitimately distinct handset products");
    const bySku=new Map(offers.map(offer=>[offer.productId,offer]));
    for(const row of rows){
      assert.equal(bySku.get(row.skuId)?.title,row.name.short,"SKU must own its own title");
      assert.equal(bySku.get(row.skuId)?.image,row.primaryImage.piscesHref,"SKU must own its own image");
      assert.equal(bySku.get(row.skuId)?.sourceUrl,row.pdpUrl,"SKU must own its own PDP link");
      assert.equal(bySku.get(row.skuId)?.price,row.price.customerPrice,"SKU must own its own price");
    }
  }
});


test('v21.30 RED: Best Buy price and SKU cannot bridge sibling JSON records',()=> {
  // Synthetic minimized parser counterexample: the first record has a valid
  // positive price but no SKU, while the next sibling has a SKU/URL/title.
  // Neither record alone contains a valid sellable offer. Adjacent-text regex
  // must not fabricate an offer from their unrelated fields.
  const rows=[
    {price:{customerPrice:999.99},name:{short:'Apple iPhone 17 Pro 256GB'}},
    {skuId:'760002',pdpUrl:'https://www.bestbuy.com/product/apple-iphone-17-pro-max-512gb/P17MAX/sku/760002',name:{short:'Apple iPhone 17 Pro Max 512GB'}}
  ];
  for(const ordered of [rows,[...rows].reverse()]){
    const offers=extractBestBuySearchOffers(JSON.stringify({products:ordered}),'iPhone 17 Pro');
    assert.deepEqual(offers,[], 'sibling price must not attach to another SKU');
  }
  // Complete independently owned product records still parse, including
  // either list ordering; avoid fixing contamination by suppressing recall.
  const valid=[
    {price:{customerPrice:999.99},skuId:'760001',pdpUrl:'https://www.bestbuy.com/product/apple-iphone-17-pro-256gb/P17PRO/sku/760001',name:{short:'Apple iPhone 17 Pro 256GB'}},
    {price:{customerPrice:1299.99},skuId:'760002',pdpUrl:'https://www.bestbuy.com/product/apple-iphone-17-pro-max-512gb/P17MAX/sku/760002',name:{short:'Apple iPhone 17 Pro Max 512GB'}}
  ];
  for(const ordered of [valid,[...valid].reverse()]){
    const offers=extractBestBuySearchOffers(JSON.stringify({products:ordered}),'iPhone 17 Pro');
    assert.equal(offers.length,2);
    for(const row of valid){
      assert.equal(offers.find(offer=>offer.productId===row.skuId)?.price,row.price.customerPrice);
    }
  }
});
