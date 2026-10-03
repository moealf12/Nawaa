import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import {resolveProductUrl} from '../server/url-resolver.mjs';
import {auditSource} from '../server/audit-contract.mjs';
import * as jarir from '../server/providers/jarir.mjs';

const url='https://fixture.example/products/shirt';
const product={ '@type':'Product',name:'Shirt',brand:'Brand',sku:'DEFAULT-SKU',mpn:'MODEL-1',offers:[
  {name:'Black',sku:'SHIRT-BLK',price:10,priceCurrency:'SAR',availability:'https://schema.org/InStock',url:'/products/shirt?variant=11'},
  {name:'White',sku:'SHIRT-WHT',price:20,priceCurrency:'SAR',availability:'https://schema.org/InStock',url:'/products/shirt?variant=22'},
]};
async function withProduct(p,run){
  const oldFetch=globalThis.fetch,oldLookup=dns.lookup;
  try{dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
    globalThis.fetch=async()=>new Response(`<script type="application/ld+json">${JSON.stringify(p)}</script>`,{headers:{'content-type':'text/html'}});
    return await run();
  }finally{globalThis.fetch=oldFetch;dns.lookup=oldLookup;}
}
test('explicit higher-priced variant retains its own price, SKU and URL',async()=>{
  await withProduct(product,async()=>{
    const r=await resolveProductUrl(url+'?variant=22');
    assert.equal(r.originalProductPrice,20);assert.equal(r.sku,'SHIRT-WHT');
    assert.equal(r.variantId,'22');assert.equal(r.sourceUrl,url+'?variant=22');
    assert.equal(r.specs.modelNumber,'MODEL-1');
    assert.equal(r.title,'Shirt · White');
  });
});
test('variant-less product preserves SKU separately and does not manufacture MPN from it',async()=>{
  await withProduct({'@type':'Product',name:'Shirt',sku:'SHIRT-1',offers:{price:30,priceCurrency:'SAR'}},async()=>{
    const r=await resolveProductUrl(url);assert.equal(r.sku,'SHIRT-1');assert.equal(r.specs.modelNumber,null);assert.equal(r.originalProductPrice,30);
  });
});
test('unknown variant and unrelated host or path cannot use a sibling/default offer',async()=>{
  await withProduct(product,async()=>{await assert.rejects(()=>resolveProductUrl(url+'?variant=999'),/variant/i);});
  for(const badUrl of ['https://other.example/products/shirt?variant=22','/products/another-shirt?variant=22']){
    await withProduct({...product,offers:[{...product.offers[1],url:badUrl}]},async()=>{await assert.rejects(()=>resolveProductUrl(url+'?variant=22'),/variant/i);});
  }
});
test('variant identity cannot pass an audit using same SKU/title on another variant URL',async()=>{
  const offer={provider:'shopify',providerMarket:'fixture',merchant:'Fixture',merchantCountryCode:'SA',title:'Shirt',sku:'SHIRT-1',specs:{},sourceUrl:url+'?variant=22',productPrice:20,originalProductPrice:20,currency:'SAR',originalCurrency:'SAR',condition:'new'};
  const r=await auditSource({source:{id:'shopify:fixture',name:'Fixture',adapter:'shopify',status:'configured'},query:'shirt',search:async()=>({offers:[offer],errors:[]}),verifyPage:async()=>({...offer,sourceUrl:url+'?variant=11'})});
  assert.equal(r.status,'PAGE_VERIFICATION_FAILED');assert.equal(r.pageChecks[0].code,'PAGE_IDENTITY_MISMATCH');
});
test('variant Offer SKU cannot be replaced by conflicting generic product SKU',async()=>{
  await withProduct({...product,sku:'DEFAULT-SKU'},async()=>{
    const r=await resolveProductUrl(url+'?variant=11');assert.equal(r.sku,'SHIRT-BLK');assert.notEqual(r.sku,'DEFAULT-SKU');
  });
});
test('redirect cannot discard or change an explicit requested variant',async()=>{
  for(const redirect of [url,url+'?variant=11','https://other.example/products/shirt?variant=22']){
    await withProduct(product,async()=>{
      const htmlFetch=globalThis.fetch;
      let first=true;
      globalThis.fetch=async(...args)=>{
        if(first){first=false;return new Response(null,{status:302,headers:{location:redirect}});}
        return htmlFetch(...args);
      };
      await assert.rejects(()=>resolveProductUrl(url+'?variant=22'),/variant/i);
    });
  }
});

const catalog=()=>({provider:'jarir-direct',providerMarket:'jarir-sa',merchant:'Jarir',merchantCountryCode:'SA',title:'HP Laptop',sourceUrl:'https://www.jarir.com/sa-en/hp-678436.html',productPrice:4599,originalProductPrice:4599,currency:'SAR',originalCurrency:'SAR',condition:'new',shipping:null,tax:null,deliveryDays:null,specs:{brand:'HP',modelNumber:'D80WREAA2N'},sourceMeta:{productId:'678436',parsedFrom:'jarir-constructor-search'}});
const page=()=>({...catalog(),productPrice:3199,originalProductPrice:3199,availability:'in_stock',observedAt:'2026-10-03T13:00:00.000Z'});
test('Jarir public search uses current product page price instead of stale index',async()=>{
  const oldFetch=globalThis.fetch,oldLookup=dns.lookup;
  try{
    dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
    globalThis.fetch=async u=>String(u).startsWith('https://ac.cnstrc.com/')
      ? Response.json({response:{results:[{value:'HP Laptop',data:{id:'678436',url:'hp-678436.html',price:4599,metadata:{brand:'HP',mpn:'D80WREAA2N'}}}]}})
      :new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'HP Laptop',brand:'HP',mpn:'D80WREAA2N',offers:{price:3199,priceCurrency:'SAR',availability:'https://schema.org/InStock',url:String(u)}})+'</script>',{headers:{'content-type':'text/html'}});
    const r=await jarir.searchJarir('HP laptop');
    assert.equal(r.offers[0].productPrice,3199);
    assert.equal(r.offers[0].originalProductPrice,3199);
    assert.equal(r.offers[0].sourceMeta.indexPrice,4599);
    assert.equal(r.offers[0].sourceMeta.priceSource,'product-page');
    assert.equal(r.offers[0].shipping,null);assert.equal(r.offers[0].tax,null);
    assert.deepEqual(r.diagnostics.pageRefresh,{attempted:1,verified:1,failed:0});
  }finally{globalThis.fetch=oldFetch;dns.lookup=oldLookup;}
});
test('Jarir failed, mismatched and invalid pages never return stale prices',async()=>{
  for(const resolvePage of [async()=>{throw new Error('HTTP 403');},async()=>({...page(),sku:'OTHER',specs:{brand:'Dell',modelNumber:'OTHER'}}),async()=>({...page(),sourceUrl:'https://other.example/hp-678436.html'}),async()=>({...page(),title:'HP Printer'}),... [0,-1,NaN,Infinity].map(price=>async()=>({...page(),productPrice:price,originalProductPrice:price})),async()=>({...page(),originalCurrency:'USD'})]){
    const r=await jarir.refreshJarirPrices([catalog()],'HP laptop',{resolvePage});
    assert.deepEqual(r.offers,[]);assert.equal(r.errors.length,1);
    assert.deepEqual(r.pageRefresh,{attempted:1,verified:0,failed:1});
  }
});
test('Jarir refresh bounds concurrency but retains all thirteen matching offers in order',async()=>{
  let active=0,maximum=0;
  const offers=Array.from({length:13},(_,i)=>({...catalog(),sourceUrl:`https://www.jarir.com/sa-en/hp-${i}.html`,sourceMeta:{productId:String(i)}}));
  const r=await jarir.refreshJarirPrices(offers,'HP laptop',{resolvePage:async sourceUrl=>{
    active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,5));active--;
    return {...page(),sourceUrl};
  }});
  assert.ok(maximum<=6);assert.ok(maximum>1);
  assert.equal(r.offers.length,13);assert.deepEqual(r.offers.map(x=>x.sourceMeta.productId),Array.from({length:13},(_,i)=>String(i)));
  assert.deepEqual(r.pageRefresh,{attempted:13,verified:13,failed:0});
});
test('Jarir query filtering precedes page lookup and failed refresh cannot pass a negative control',async()=>{
  const r=await jarir.refreshJarirPrices([catalog()],'nawaa-unfindable-943271',{resolvePage:async()=>{throw Error('unexpected lookup');}});
  assert.deepEqual(r.offers,[]);assert.deepEqual(r.errors,[]);
  assert.deepEqual(r.pageRefresh,{attempted:0,verified:0,failed:0});
  const failed=await jarir.refreshJarirPrices([catalog()],'HP laptop',{resolvePage:async()=>{throw Error('HTTP 403');}});
  const report=await auditSource({source:{id:'jarir',name:'Jarir',adapter:'jarir-direct',status:'configured'},query:'HP laptop',expected:'empty',search:async()=>({offers:failed.offers,errors:failed.errors,diagnostics:{queryFilter:{input:2,retained:1,removed:1},pageRefresh:failed.pageRefresh}})});
  assert.equal(report.status,'BLOCKED');
  assert.deepEqual(report.providerQueryFilter,{input:2,retained:1,removed:1});
  assert.deepEqual(report.providerPageRefresh,{attempted:1,verified:0,failed:1});
});
test('Jarir partial refresh retains separate filtering and page-failure counts',async()=>{
  const result=await jarir.refreshJarirPrices([catalog(),{...catalog(),sourceUrl:'https://www.jarir.com/sa-en/hp-broken.html'},{...catalog(),title:'Dell Printer'}],'HP laptop',{resolvePage:async sourceUrl=>{if(sourceUrl.includes('broken')) throw Error('HTTP 403');return page();}});
  const report=await auditSource({source:{id:'jarir',name:'Jarir',adapter:'jarir-direct',status:'configured'},query:'HP laptop',search:async()=>({...result,diagnostics:{queryFilter:result.queryFilter,pageRefresh:result.pageRefresh}}),verifyPage:async()=>page()});
  assert.equal(report.status,'PARTIAL_SAMPLE');assert.deepEqual(report.errorCodes,['HTTP_403']);
  assert.deepEqual(report.providerQueryFilter,{input:3,retained:2,removed:1});
  assert.deepEqual(report.providerPageRefresh,{attempted:2,verified:1,failed:1});
});
test('same merchant different listing cannot provide the current Jarir price',async()=>{
  const result=await jarir.refreshJarirPrices([catalog()],'HP laptop',{resolvePage:async()=>({...page(),sourceUrl:'https://www.jarir.com/sa-en/hp-OTHER.html'})});
  assert.deepEqual(result.offers,[]);assert.equal(result.pageRefresh.failed,1);
});
test('fetched redirect provenance cannot be hidden by an Offer URL pointing back to Jarir',async()=>{
  const p={'@type':'Product',name:'HP Laptop',brand:'HP',mpn:'D80WREAA2N',offers:{price:999,priceCurrency:'SAR',url:catalog().sourceUrl}};
  await withProduct(p,async()=>{
    const htmlFetch=globalThis.fetch;let first=true;
    globalThis.fetch=async(...args)=>{if(first){first=false;return new Response(null,{status:302,headers:{location:'https://other.example/hp.html'}});}return htmlFetch(...args);};
    const resolved=await resolveProductUrl(catalog().sourceUrl);
    const result=await jarir.refreshJarirPrices([catalog()],'HP laptop',{resolvePage:async()=>resolved});
    assert.deepEqual(result.offers,[]);assert.equal(result.pageRefresh.failed,1);
    const report=await auditSource({source:{id:'jarir',name:'Jarir',adapter:'jarir-direct',status:'configured'},query:'HP laptop',search:async()=>({offers:[catalog()],errors:[]}),verifyPage:async()=>resolved});
    assert.equal(report.status,'PAGE_VERIFICATION_FAILED');
    assert.equal(report.pageChecks[0].code,'PAGE_IDENTITY_MISMATCH');
  });
});
test('embedded conflicting MPN stays distinct from SKU and cannot overwrite a catalog model price',async()=>{
  const oldFetch=globalThis.fetch,oldLookup=dns.lookup;
  try{
    dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
    globalThis.fetch=async()=>new Response('<script type="application/json">'+JSON.stringify({name:'HP Laptop',brand:'HP',mpn:'DIFFERENT-MODEL',price:999,currency:'SAR'})+'</script>',{headers:{'content-type':'text/html'}});
    const result=await jarir.refreshJarirPrices([catalog()],'HP laptop');
    assert.deepEqual(result.offers,[]);assert.equal(result.pageRefresh.failed,1);
    const resolved=await resolveProductUrl(catalog().sourceUrl);
    assert.equal(resolved.sku,null);assert.equal(resolved.specs.modelNumber,'DIFFERENT-MODEL');
  }finally{globalThis.fetch=oldFetch;dns.lookup=oldLookup;}
});
test('eXtra short and canonical product paths agree only for the same Saudi product ID',async()=>{
  const {sameOfferIdentity}=await import('../server/product-identity.mjs');
  const left={...catalog(),provider:'extra-unbxd',sourceUrl:'https://www.extra.com/en-sa/p/100460146'};
  const canonical='https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17/p/100460146';
  assert.equal(sameOfferIdentity(left,{...left,sourceUrl:canonical,resolvedPageUrl:canonical}),true);
  for(const wrong of [canonical.replace('100460146','100460999'),canonical.replace('/en-sa/','/en-ae/'),canonical.replace('www.extra.com','other.example')]){
    assert.equal(sameOfferIdentity(left,{...left,sourceUrl:wrong,resolvedPageUrl:wrong}),false);
  }
  assert.equal(sameOfferIdentity(catalog(),{...page(),sourceUrl:'https://www.jarir.com/sa-en/another-'+catalog().sourceMeta.productId+'.html'}),false);
});
