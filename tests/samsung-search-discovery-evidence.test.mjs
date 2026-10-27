import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSamsungSearchDiscovery, searchFreeStorefrontById } from '../server/providers/free-storefronts.mjs';

const query='galaxy s25';
const search='https://www.samsung.com/sa_en/search/?searchvalue=galaxy%20s25';
const fixtures=[
 ['https://www.samsung.com/sa_en/smartphones/galaxy-s26-ultra/buy/','Galaxy S26 Ultra'],
 ['https://www.samsung.com/sa_en/smartphones/galaxy-z-fold8/buy/','Galaxy Z Fold8'],
 ['https://www.samsung.com/sa_en/smartphones/galaxy-s25-fe/buy/','Galaxy S25 FE'],
 ['https://www.samsung.com/sa_en/about-us/','Galaxy S25'],
];
const html=rows=>'<html><body>'+rows.map(([url,label])=>'<a href="'+url+'">'+label+'</a>').join('')+'</body></html>';

test('RED: sampled Samsung source evidence attributes zero exact S25 while identifying wrong-model and navigation links',()=>{
  const d=inspectSamsungSearchDiscovery(html(fixtures),search,query);
  assert.equal(d.requestedModel,'galaxy s25');
  assert.equal(d.exactModelBuyPdp,0);
  assert.equal(d.offModelBuyPdp,3);
  assert.equal(d.nonPurchaseCandidates,1);
  assert.ok(d.offModelPaths.some(x=>x.includes('galaxy-s26-ultra')));
  assert.equal(JSON.stringify(d).includes('searchvalue='),false,'never include raw search URL, query parameters or shopper tokens');
});

test('positive: actual Samsung S25 PDP on a search HTML sample is reported without suggesting a verified price',()=>{
  const valid='https://www.samsung.com/sa_en/smartphones/galaxy-s25/buy/?modelCode=SM-S931B';
  const d=inspectSamsungSearchDiscovery(html([...fixtures,[valid,'Galaxy S25']]),search,query);
  assert.equal(d.exactModelBuyPdp,1);
  assert.ok(d.exactModelPaths.includes('/sa_en/smartphones/galaxy-s25/buy/'));
  assert.equal('productPrice' in d,false);
  assert.equal('verifiedOffers' in d,false);
});

test('positive: broader Galaxy discovery does not imply a narrow model',()=>{
  const d=inspectSamsungSearchDiscovery(html(fixtures),search,'galaxy');
  assert.equal(d.requestedModel,null);
  assert.equal(d.exactModelBuyPdp,null);
});

test('integration: zero-offer Samsung searches report bounded acquisition evidence, without PDP fetches',async()=>{
  const previous=globalThis.fetch;
  try{
    let count=0;
    globalThis.fetch=async(input)=>{
      count++;
      assert.equal(new URL(String(input)).pathname,'/sa_en/search/');
      return new Response(html(fixtures),{status:200,headers:{'content-type':'text/html'}});
    };
    const result=await searchFreeStorefrontById('samsung-sa',query,{perStore:3});
    assert.equal(count,1);
    assert.equal(result.offers.length,0);
    assert.equal(result.diagnostics.samsungDiscovery.exactModelBuyPdp,0);
    assert.equal(result.diagnostics.samsungDiscovery.offModelBuyPdp,3);
  } finally {globalThis.fetch=previous;}
});
