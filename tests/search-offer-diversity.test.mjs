import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDiverseOffers, offerMerchantKey} from '../server/offer-selection.mjs';

// Synthetic regression reproducing the source-mix failure. Never count these as live merchant observations.
const offer=(provider,merchant,index,confidence,exactMatch=true)=>({
  provider,providerMarket:provider,merchant,sourceUrl:'https://example.invalid/'+provider+'/'+index,
  title:'Sony PlayStation 5 Console 1TB',matchConfidence:confidence,exactMatch,
  productPrice:2400+index
});
test('v17.4: first shopper window keeps multiple trustworthy merchants within the same relevance band',()=>{
  const dominant=Array.from({length:12},(_,i)=>offer('extra-unbxd','eXtra',i,.99-i*.001));
  const jarir=offer('jarir-direct','Jarir',1,.97);
  const sharaf=offer('sharafdg-algolia','Sharaf DG',1,.96);
  const global=offer('bestbuy-us','Best Buy',1,.95);
  const accessory=offer('accessory','Accessory listing',1,.99,false);
  const result=selectDiverseOffers([...dominant,jarir,sharaf,global,accessory],10);
  assert.equal(result.length,10,'retain first-page cap');
  assert.deepEqual(result.slice(0,4).map(item=>item.merchant),
    ['eXtra','Jarir','Sharaf DG','Best Buy'],
    'four similarly relevant merchants should be visible before repeated dominant listings');
  assert.ok(result.every(item=>item.exactMatch),'never promote accessories over exact consoles');
  assert.equal(new Set(result.map(offerMerchantKey)).size,4);
});
test('v17.4: low-confidence exact flags cannot leapfrog materially stronger verified offers',()=>{
  const high=offer('extra-unbxd','eXtra',1,.99);
  const near=offer('jarir-direct','Jarir',1,.94);
  const weak=offer('weak-market','Weak Listing',1,.35);
  const related=offer('related-market','Related Listing',1,.98,false);
  const result=selectDiverseOffers([weak,related,near,high],Infinity);
  assert.deepEqual(result.map(x=>x.merchant),['eXtra','Jarir','Weak Listing','Related Listing']);
});
test('v17.4: no duplicates are invented by ranking and zero cap stays empty',()=>{
  const a=offer('extra-unbxd','eXtra',0,.99);
  assert.deepEqual(selectDiverseOffers([a],0),[]);
  assert.deepEqual(selectDiverseOffers([a],1),[a]);
});

test('v17.4: malformed merchant confidence cannot stall selection or fabricate stronger ranking',()=>{
 const malformed=offer('untrusted-source','Malformed',1,Infinity,true);
 const genuine=offer('jarir-direct','Jarir',1,.95,true);
 const nan=offer('another-source','NaN',1,NaN,false);
 const result=selectDiverseOffers([malformed,nan,genuine],10);
 assert.equal(result.length,3);
 assert.equal(result[0].merchant,'Jarir');
 assert.equal(result[1].merchant,'Malformed');
 assert.equal(result[2].merchant,'NaN');
});

test("Read-side merchant diversification cannot revive stale Amazon DE prices",()=>{
  const stale=offer("free-storefronts","Amazon Germany",3,.99);
  stale.providerMarket="amazon-de";
  stale.sourceUrl="https://www.amazon.de/dp/B0FQFW3423";
  stale.productPrice=1;
  stale.sourceMeta={priceEvidence:"VERIFIED",trustBadge:true,buyerVisiblePriceParity:true};
  const forged=offer("custom-provider","Forged merchant",4,.99);
  forged.sourceUrl="https://www.amazon.de/dp/B0FQFW3423";
  forged.productPrice=1;
  const safe=offer("jarir-direct","Jarir",2,.96);
  assert.deepEqual(selectDiverseOffers([stale,forged,safe],Infinity),[safe]);
});
