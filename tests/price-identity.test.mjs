import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import {resolveProductUrl,extractionCandidates} from '../server/url-resolver.mjs';
import {auditSource} from '../server/audit-contract.mjs';
import * as jarir from '../server/providers/jarir.mjs';

const url='https://fixture.example/products/shirt';
const pixelData=()=>({shop:{name:'Tentree',paymentSettings:{currencyCode:'USD'},myshopifyDomain:'tentree-development-store.myshopify.com',countryCode:'US',storefrontUrl:'https://fixture.example'},customer:null,cart:null,checkout:null,productVariants:[
 {id:'43940667916474',sku:'TCM4546-3560-S',title:'METEORITE BLACK RUSTIC PLAID / S',price:{amount:58.8,currencyCode:'USD'},product:{id:'7910652936378',title:'Forest Flannel Shirt',vendor:'tentree',url:'/products/shirt',type:'Mens'},image:{src:'//fixture.example/shirt-s.jpg'}},
 {id:'43940667982010',sku:'TCM4546-3560-L',title:'METEORITE BLACK RUSTIC PLAID / L',price:{amount:58.8,currencyCode:'USD'},product:{id:'7910652936378',title:'Forest Flannel Shirt',vendor:'tentree',url:'/products/shirt',type:'Mens'},image:{src:'//fixture.example/shirt-l.jpg'}},
]});
const pixelHtml=data=>`<script>(function(){wpmLoader({shopId:23413995,storefrontBaseUrl:"https://fixture.example",initData: ${JSON.stringify(data)},other: true});})();</script>`;
const pixelUrl=url+'?variant=43940667982010';
const pixelCandidate=(html,pageUrl=pixelUrl)=>extractionCandidates(html,pageUrl).find(e=>e.strategy==='storefront_data')?.product || null;
async function withHtml(html,run){
 const oldFetch=globalThis.fetch,oldLookup=dns.lookup;
 try{dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
  globalThis.fetch=async()=>new Response(html,{headers:{'content-type':'text/html'}});
  return await run();
 }finally{globalThis.fetch=oldFetch;dns.lookup=oldLookup;}
}
test('Shopify initData page verifies the requested L variant in major units without inventing stock',async()=>{
 await withHtml(pixelHtml(pixelData()),async()=>{
  const r=await resolveProductUrl(pixelUrl);
  assert.equal(r.originalProductPrice,58.8);assert.equal(r.originalCurrency,'USD');
  assert.equal(r.sku,'TCM4546-3560-L');assert.equal(r.variantId,'43940667982010');
  assert.equal(r.sourceUrl,pixelUrl);assert.equal(r.resolvedPageUrl,pixelUrl);
  assert.equal(r.title,'Forest Flannel Shirt · METEORITE BLACK RUSTIC PLAID / L');
  assert.equal(r.image,'https://fixture.example/shirt-l.jpg');
  assert.equal(r.availability,'unknown');assert.equal(r.shipping,null);assert.equal(r.tax,null);
  assert.equal(r.specs.brand,null);assert.equal(r.specs.modelNumber,null);
 });
});
test('Shopify pixel variant amount accepts explicit decimal major units including zero',()=>{
 for(const [amount,want] of [[0,0],[58.8,58.8],['58.80',58.8]]){
  const data=pixelData();data.productVariants[1].price.amount=amount;
  assert.equal(pixelCandidate(pixelHtml(data))?.offers.price,want);
 }
});
test('invalid pixel price or currency cannot establish a priced variant',()=>{
 for(const amount of ['',null,-1,'Infinity','1e999',' 58.8 ',{},true]){
  const data=pixelData();data.productVariants[1].price.amount=amount;
  assert.equal(pixelCandidate(pixelHtml(data)),null,String(amount));
 }
 for(const currencyCode of [undefined,'','XYZ','usd']){
  const data=pixelData();data.productVariants[1].price.currencyCode=currencyCode;
  assert.equal(pixelCandidate(pixelHtml(data)),null,String(currencyCode));
 }
});
test('pixel URL identity rejects another product, host, port or credentials',()=>{
 for(const productUrl of ['/products/other','https://other.example/products/shirt','https://fixture.example:8000/products/shirt','https://user:pass@fixture.example/products/shirt','http://fixture.example/products/shirt']){
  const data=pixelData();data.productVariants[1].product.url=productUrl;
  assert.equal(pixelCandidate(pixelHtml(data)),null,productUrl);
 }
 assert.equal(pixelCandidate(pixelHtml(pixelData()),url+'?variant=999'),null);
 const missing=pixelData();delete missing.productVariants[1].id;
 assert.equal(pixelCandidate(pixelHtml(missing)),null);
});
test('duplicate pixel variant IDs and repeated qualifying blocks fail closed',()=>{
 const data=pixelData();data.productVariants.push({...data.productVariants[1],price:{amount:1,currencyCode:'USD'}});
 assert.equal(pixelCandidate(pixelHtml(data)),null);
 assert.equal(pixelCandidate(pixelHtml(pixelData())+pixelHtml(pixelData())),null);
});
test('pixel parsing is bounded literal JSON and ignores unrelated recommendation data',async()=>{
 const data=pixelData();data.productVariants[1].product.title='Forest {Flannel} "Shirt"';
 const html=pixelHtml(data)+'<script>throw new Error("must never execute");</script>';
 assert.equal(pixelCandidate(html)?.name,'Forest {Flannel} "Shirt"');
 assert.equal(pixelCandidate('<div>initData: '+JSON.stringify(data)+'</div>'),null);
 assert.equal(pixelCandidate('<script>var wpmLoader={initData: invalid()};</script>'),null);
 await withHtml('<script type="application/json">'+JSON.stringify({recommendations:data.productVariants})+'</script>',async()=>{
  await assert.rejects(()=>resolveProductUrl(pixelUrl),/variant/i);
 });
 const large=pixelData();large.customer={padding:'x'.repeat(1500001)};
 assert.equal(pixelCandidate(pixelHtml(large)),null);
 const many=pixelData();many.productVariants=Array.from({length:501},(_,i)=>({...many.productVariants[0],id:String(i)}));
 assert.equal(pixelCandidate(pixelHtml(many)),null);
});
test('unrelated pixel payload cannot override an independently verified JSON-LD variant',async()=>{
 const data=pixelData();data.productVariants[1].product.url='/products/other';
 const schema={'@type':'Product',name:'Shirt',brand:'Actual Brand',offers:{name:'Large',sku:'ACTUAL-L',price:123,priceCurrency:'SAR',url:pixelUrl}};
 await withHtml(pixelHtml(data)+`<script type="application/ld+json">${JSON.stringify(schema)}</script>`,async()=>{
  const r=await resolveProductUrl(pixelUrl);assert.equal(r.sku,'ACTUAL-L');assert.equal(r.originalProductPrice,123);assert.equal(r.specs.brand,'Actual Brand');
 });
});
test('pixel price evidence cannot conceal a redirect that discarded the variant',async()=>{
 await withHtml(pixelHtml(pixelData()),async()=>{
  const htmlFetch=globalThis.fetch;let first=true;
  globalThis.fetch=async(...args)=>{
   if(first){first=false;return new Response(null,{status:302,headers:{location:url}});}
   return htmlFetch(...args);
  };
  await assert.rejects(()=>resolveProductUrl(pixelUrl),/variant/i);
 });
});
test('a wpmLoader mention cannot qualify unrelated initData as variant price evidence',async()=>{
 const data=pixelData();
 for(const mention of ['/* wpmLoader */','const label="wpmLoader";','// wpmLoader\n']){
  const html=`<script>${mention} const recommendations={initData: ${JSON.stringify(data)}};</script>`;
  await withHtml(html,async()=>{await assert.rejects(()=>resolveProductUrl(pixelUrl),/variant/i);});
 }
 const nested=`<script>wpmLoader({recommendations:{initData: ${JSON.stringify(data)}}});</script>`;
 await withHtml(nested,async()=>{await assert.rejects(()=>resolveProductUrl(pixelUrl),/variant/i);});
});
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
