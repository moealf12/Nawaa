import test from 'node:test';
import assert from 'node:assert/strict';
import {groupComparableOffers} from '../src/search-core.mjs';
const base={condition:'new',availability:'in_stock',exactMatch:true,matchConfidence:1,productPrice:1000,shipping:null,merchant:'A'};
const phone=(merchant,title,specs={})=>({...base,merchant,title,specs:{brand:'Apple',...specs}});

test('same phone identity groups across merchant wording with a missing model number',()=>{
 const offers=[phone('A','Apple iPhone 17 256GB Black',{deviceType:'iPhone 17',storage:'256GB',color:'Black',modelNumber:'MG674AH/A'}),phone('B','iPhone 17 Smartphone Black 256 GB',{storage:'256 GB',color:'Black'})];
 assert.equal(groupComparableOffers(offers).length,1);
});
test('a shared manufacturer model groups merchant wording but cannot override conflicting capacity',()=>{
 const offers=[{...base,title:'HP Notebook 15 Laptop',specs:{brand:'HP',modelNumber:'D80WREA',ram:'16GB',storage:'512GB'}},{...base,merchant:'B',title:'HP 15 Laptop Intel Core 7',specs:{brand:'HP',modelNumber:'D80WREA',ram:'16 GB',storage:'512 GB'}}];
 assert.equal(groupComparableOffers(offers).length,1);
 assert.equal(groupComparableOffers([...offers,{...offers[1],specs:{...offers[1].specs,ram:'8GB'}}]).length,2);
});
test('generic family metadata cannot merge distinct unnamed HP products',()=>{
 const offers=[{...base,title:'HP Smart Tank 580 Printer',specs:{brand:'HP',series:'SmartTank'}},{...base,title:'HP Smart Tank 585 Printer',specs:{brand:'HP',series:'SmartTank'}}];
 assert.equal(groupComparableOffers(offers).length,2);
});
test('incompatible regions, conditions, capacities and clothing sizes remain separate',()=>{
 const first=phone('A','iPhone 17 256GB Black',{storage:'256GB',color:'Black',regionVersion:'Middle East'});
 for(const other of [{...first,condition:'used'},{...first,specs:{...first.specs,storage:'512GB'}},{...first,specs:{...first.specs,regionVersion:'USA'}},{...first,specs:{...first.specs,color:'White'}}]) assert.equal(groupComparableOffers([first,other]).length,2);
 const shirt={...base,title:'Forest Shirt',brand:'Acme',specs:{Size:'M'}};
 assert.equal(groupComparableOffers([shirt,{...shirt,specs:{Size:'L'}}]).length,2);
});
test('a missing identifier cannot bridge conflicting manufacturer models',()=>{
 const first=phone('A','iPhone 17 256GB Black',{storage:'256GB',color:'Black',modelNumber:'MG674AH/A'});
 const second={...first,merchant:'B',specs:{...first.specs,modelNumber:'MG674LL/A'}};
 const unknown={...first,merchant:'C',specs:{storage:'256GB',color:'Black',brand:'Apple'}};
 for(const offers of [[first,unknown,second],[unknown,second,first],[second,first,unknown]]) assert.equal(groupComparableOffers(offers).length,3);
});

test('unknown Saudi delivery never leads as a confirmed arrival total',async()=>{
 const {buildOfferIntelligence}=await import('../src/search-core.mjs');
 const unknown={...base,title:'HP ProBook 440 G8 Laptop',canShipToSaudi:null,shipping:0,importCost:0,tax:0,mandatoryFees:0,discount:0};
 const result=buildOfferIntelligence(groupComparableOffers([unknown])[0]);
 assert.equal(result.priceBasis,'advertised_price');
});
test('price differences do not compare product-only price against a confirmed arrival total',async()=>{
 const {buildOfferIntelligence}=await import('../src/search-core.mjs');
 const confirmed={...base,title:'HP ProBook 440 G8 Laptop',canShipToSaudi:true,shipping:50,importCost:0,tax:0,mandatoryFees:0,discount:0};
 const unknown={...base,title:'HP ProBook 440 G8 Laptop',merchant:'B',productPrice:800};
 const result=buildOfferIntelligence(groupComparableOffers([confirmed,unknown])[0]);
 assert.equal(result.priceBasis,'comparable_total');
 assert.equal(result.rows.find(row=>row.offer.merchant==='B').delta,null);
});

test('insufficient phone identity stays separate with distinct selectable group keys',()=>{
 const offers=[phone('A','Apple iPhone 17'),phone('B','Apple iPhone 17')];
 const groups=groupComparableOffers(offers);
 assert.equal(groups.length,2);assert.equal(new Set(groups.map(g=>g.key)).size,2);
});

test('generic laptop names without a model or configuration are not proof of identical products',()=>{
 const offers=[{...base,title:'HP Pavilion Laptop',specs:{brand:'HP'}},{...base,title:'HP Pavilion Laptop',merchant:'B',specs:{brand:'HP'}}];
 assert.equal(groupComparableOffers(offers).length,2);
});

test('real Jarir/eXtra iPhone 17 256GB Black same-MPN offers group despite inch-notation differences',()=>{
 // Recorded 2026-10-20 merchant Constructor/Unbxd source metadata + independently checked PDP MPNs.
 // Recorded real feed replay; not current live-price certification.
 const jarir=phone('Jarir','Apple iPhone 17, 256 GB, Black, 5G, Apple A19',{
  deviceType:'iPhone 17',series:'Apple iPhone 17',storage:'256 GB',color:'Black',
  screenSize:'6.3"',sim:'Dual eSIM (eSIM/eSIM)',modelNumber:'MG674AHA'
 });
 const extra=phone('eXtra','Apple iPhone 17, 5G, 6.3 inch 256GB, Black',{
  deviceType:'IPHONE 17',series:'IPHONE 17',storage:'256 GB',color:'Black',
  screenSize:'6.3 INCH',ram:'8GB',modelNumber:'MG674AH/A'
 });
 const groups=groupComparableOffers([jarir,extra]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].offers.length,2);
 assert.deepEqual(new Set(groups[0].offers.map(o=>o.merchant)),new Set(['Jarir','eXtra']));
 for(const altered of [
  {...extra,specs:{...extra.specs,storage:'512 GB'}},
  {...extra,specs:{...extra.specs,color:'Lavender'}},
  {...extra,specs:{...extra.specs,modelNumber:'MG674LL/A'}},
  {...extra,specs:{...extra.specs,screenSize:'6.9 INCH'}},
  {...extra,specs:{...extra.specs,screenSize:'6.3 cm'}},
  {...extra,specs:{...extra.specs,regionVersion:'USA'}}
 ]) assert.equal(groupComparableOffers([jarir,altered]).length,2);
});

test('real Jarir/eXtra iPhone 17 256GB Lavender same-MPN merchant pair groups',()=>{
 const jarir=phone('Jarir','Apple iPhone 17, 256 GB, Lavender, 5G, Apple A19',{
  deviceType:'iPhone 17',storage:'256 GB',color:'Lavender',
  screenSize:'6.3"',modelNumber:'MG6A4AHA'
 });
 const extra=phone('eXtra','Apple iPhone 17, 5G, 6.3 inch 256GB, Lavender',{
  deviceType:'IPHONE 17',storage:'256 GB',color:'Lavender',
  screenSize:'6.3 INCH',modelNumber:'MG6A4AH/A'
 });
 assert.equal(groupComparableOffers([jarir,extra]).length,1);
});
