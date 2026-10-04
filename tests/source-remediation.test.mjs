import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import {searchJarir,parseJarirSearchHtml,parseJarirConstructorPayload} from '../server/providers/jarir.mjs';
import {searchExtraUnbxd} from '../server/providers/extra-unbxd.mjs';
import {searchFreeStorefrontById} from '../server/providers/free-storefronts.mjs';
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
test('Jarir filters recommended wrong variants and records upstream output counts',async()=>{
  await withFetch(async url=>String(url).startsWith('https://ac.cnstrc.com/')?Response.json({response:{results:[jarirItem('Apple iPhone 17 256GB','1'),jarirItem('Apple iPhone 17 Pro 256GB','2'),jarirItem('Apple iPhone 17 512GB','3')]}}):new Response(`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Apple iPhone 17 256GB',offers:{price:3000,priceCurrency:'SAR',url:String(url)}})}</script>`,{headers:{'content-type':'text/html'}}),async()=>{
    const r=await searchJarir('ايفون ١٧ ٢٥٦ جيجا');
    assert.deepEqual(r.offers.map(x=>x.sourceMeta.productId),['1']);
    assert.deepEqual(r.diagnostics.queryFilter,{input:3,retained:1,removed:2});
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
 const routes=storefronts.routeFreeStorefronts('HP',Infinity);
 const amazon=routes.find(x=>x.store.id==='amazon-sa');
 assert.ok(amazon);
 assert.equal(amazon.store.countryCode,'SA');
 assert.ok(amazon.reasons.includes('general_marketplace'));
});
