import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOfferMatch,filterQueryOffers,queryMatchReasons,parseSearchIntent,productCategory} from '../src/search-query.mjs';
const base={merchant:'eXtra',sourceUrl:'https://www.extra.com/en-sa/item/1',productPrice:2499,
  currency:'SAR',observedAt:'2026-10-16T00:00:00Z',condition:'new'};
const consoleOffer={...base,title:'Sony PS5 Console Disc Edition 1TB'};
const driveOffer={...base,sourceUrl:'https://www.extra.com/en-sa/item/2',title:'PS5 Disc Drive accessory for Digital Edition'};
const iphone={...base,sourceUrl:'https://www.extra.com/en-sa/item/3',title:'Apple iPhone 17 256GB Black'};
const caseOffer={...base,sourceUrl:'https://www.extra.com/en-sa/item/4',title:'Protective Case for Apple iPhone 17 256GB'};
test('PS5 console and separate disc-drive identities remain distinct',()=>{
  assert.equal(assessOfferMatch('PS5',consoleOffer).productKind,'console');
  assert.equal(assessOfferMatch('PS5',driveOffer).exactMatch,false);
  assert.ok(assessOfferMatch('PS5',consoleOffer).matchConfidence>assessOfferMatch('PS5',driveOffer).matchConfidence);
  assert.ok(filterQueryOffers('PS5',[consoleOffer,driveOffer]).offers.some(o=>o.sourceUrl===consoleOffer.sourceUrl));
  assert.ok(!filterQueryOffers('PS5',[consoleOffer,driveOffer]).offers.some(o=>o.sourceUrl===driveOffer.sourceUrl));
});
test('unrequested phone accessories remain demoted across repeated Arabic and English requests',()=>{
  for(const query of ['iPhone 17','ايفون 17']){
    for(let round=0;round<4;round++){
      const a=assessOfferMatch(query,iphone),b=assessOfferMatch(query,caseOffer);
      assert.ok(a.matchConfidence>b.matchConfidence);
      assert.equal(b.exactMatch,false);
      assert.equal(filterQueryOffers(query,[iphone,caseOffer]).offers.some(o=>o.sourceUrl===caseOffer.sourceUrl),false);
    }
  }
});
test('search matching does not mutate offer provenance or observed time',()=>{
  const input=[consoleOffer,driveOffer,iphone,caseOffer];
  const original=input.map(x=>structuredClone(x));
  for(const query of ['PS5','iPhone 17','ايفون 17 256 جيجا']){
    filterQueryOffers(query,input);
    input.forEach(x=>assessOfferMatch(query,x));
  }
  assert.deepStrictEqual(input,original);
});

test('batch-shared intent has identical decisions to independent matching for every offer',()=>{
  const items=[consoleOffer,driveOffer,iphone,caseOffer,
    {...base,title:'Samsung Galaxy S25 Ultra 256GB',sourceUrl:'https://example.com/galaxy'},
    {...base,title:'HP Laptop 16GB RAM',sourceUrl:'https://example.com/laptop'},
    {...base,title:'iPhone 17 Pro Max 512GB',sourceUrl:'https://example.com/promax'}];
  for(const query of ['PS5','PS5 disc drive','iPhone 17','iPhone 17 Pro Max',
    'ايفون 17 256 جيجا','HP laptop','Samsung Galaxy S25 Ultra 256GB','Nike','']){
    const expected=items.filter(item=>queryMatchReasons(query,item).length===0);
    const actual=filterQueryOffers(query,items);
    assert.deepStrictEqual(actual.offers,expected,'same accepted sources: '+query);
    assert.equal(actual.queryFilter.input,items.length);
    assert.equal(actual.queryFilter.retained,expected.length);
  }
});

test('interleaved batches preserve matching for previous queries',()=>{
  const items=[consoleOffer,driveOffer,iphone,caseOffer];
  const ps5=filterQueryOffers('PS5',items);
  const phone=filterQueryOffers('iPhone 17',items);
  for(let i=0;i<5;i++){
    assert.deepStrictEqual(filterQueryOffers('PS5',items),ps5);
    assert.deepStrictEqual(filterQueryOffers('iPhone 17',items),phone);
  }
});

test('empty provider batches retain their zero-result contract',()=>{
  assert.deepStrictEqual(filterQueryOffers('PS5',[]),
    {offers:[],queryFilter:{input:0,retained:0,removed:0}});
});

test('capacity mismatches remain enforced while unrequested capacities are not',()=>{
  const exact={...iphone,specs:{storage:'256GB'}};
  const different={...iphone,title:'Apple iPhone 17 512GB Black',specs:{storage:'512GB'}};
  assert.equal(queryMatchReasons('iPhone 17 256GB',exact).includes('capacity_conflict'),false);
  assert.equal(queryMatchReasons('iPhone 17 256GB',different).includes('capacity_conflict'),true);
  assert.equal(queryMatchReasons('iPhone 17',different).includes('capacity_conflict'),false);
  assert.equal(queryMatchReasons('ايفون 17 256 جيجا',different).includes('capacity_conflict'),true);
  assert.equal(queryMatchReasons('iPhone 17 256GB',exact).includes('model_conflict'),false);
});
test('model and storage constraints remain isolated across alternating batches',()=>{
  const items=[
    {...iphone,title:'Apple iPhone 17 256GB',specs:{storage:'256 GB',deviceType:'iPhone 17'}},
    {...iphone,title:'Apple iPhone 17 Pro 512GB',specs:{storage:'512GB',deviceType:'iPhone 17 Pro'}},
    {...iphone,title:'Apple iPhone 17 Case for 256GB',specs:{storage:'256GB'}},
  ];
  const initial=items.map(item=>structuredClone(item));
  for(let n=0;n<4;n++){
    const exact=filterQueryOffers('iPhone 17 256GB',items);
    filterQueryOffers('iPhone 17 Pro 512GB',items);
    filterQueryOffers('iPhone 17',items);
    assert.ok(exact.offers.every(x=>!queryMatchReasons('iPhone 17 256GB',x).length));
    assert.ok(!exact.offers.some(x=>x.title.includes('Pro')));
    assert.deepStrictEqual(items,initial);
  }
});

test('direct public matching with and without prepared intent is identical',()=>{
  const offers=[consoleOffer,driveOffer,iphone,caseOffer,
    {...iphone,sourceUrl:'https://example.com/iphone-pro',title:'iPhone 17 Pro 512GB Black',specs:{storage:'512GB',deviceType:'iPhone 17 Pro'}},
    {...consoleOffer,sourceUrl:'https://example.com/pad',title:'PS5 Wireless Controller'}];
  for(const query of ['PS5','PS5 disc drive','iPhone 17 256GB','ايفون 17 256 جيجا',
    'Samsung Galaxy S25 Ultra 256GB','HP laptop','Nike','Logitech mouse','','PS5 DualSense controller']){
    const parsed=parseSearchIntent(query);
    for(const offer of offers){
      assert.deepStrictEqual(assessOfferMatch(query,offer),assessOfferMatch(query,offer,parsed),query);
      assert.deepStrictEqual(queryMatchReasons(query,offer),queryMatchReasons(query,offer,parsed),query);
    }
    const expected=offers.filter(offer=>queryMatchReasons(query,offer).length===0);
    assert.deepStrictEqual(filterQueryOffers(query,offers).offers,expected,query);
  }
});


test('public product category contract preserves console and device/accessory distinction',()=>{
  const cases=[
    [consoleOffer,'console'],
    [driveOffer,'accessory'],
    [iphone,'phone'],
    [caseOffer,'accessory'],
  ];
  for(const [offer,kind] of cases){
    assert.equal(productCategory(offer),kind,offer.title);
    const snapshot=structuredClone(offer);
    for(const q of ['PS5','iPhone 17','Sony','Apple']){
      assessOfferMatch(q,offer);
      assert.equal(productCategory(offer),kind);
    }
    assert.deepStrictEqual(offer,snapshot);
  }
});


// Actual source listings observed in the candidate's own PS5 SSE on
// 2026-10-17. These items are not standalone PS5 consoles, regardless of
// source-supplied exactMatch or whether their title mentions 'Console'.
test('PS5 generic search never certifies observed covers, fans, mounts, HDDs or game codes as consoles',()=>{
  const observed=[
    ['Sony Console Covers for PlayStation 5 Slim Edition (Blu-ray/Digital), Chroma Pearl',
      'https://www.jarir.com/sa-en/sony-chroma-pearl-other-gaming-accessories-644723.html','accessory'],
    ['Sony Disc Drive for PlayStation 5 Digital Edition Slim, White',
      'https://www.jarir.com/sa-en/sony-digital-edition-slim-other-gaming-accessories-629492.html','accessory'],
    ['KASTWAVE PS5 Cooling Fan Horizontal Compatible With PlayStation 5 Disc & Digital Edition Console - Includes Light',
      'https://www.amazon.sa/-/en/KASTWAVE-Cooling-Horizontal-Compatible-PlayStation/dp/B09DRTJ194','accessory'],
    ['PS5 Wall Mount for Playstation 5 Disc Edition and Digital Edition (Mount The Console on Wall Near or Behind TV)',
      'https://www.amazon.sa/-/en/Playstation-Digital-Invisible-Including-Accessories/dp/B08VW55CSZ','accessory'],
    ['Seagate Game Drive for PS5, 2 TB, External HDD, 2.5 inch, USB 3.0',
      'https://www.amazon.sa/-/en/Seagate-External-Officially-Licensed-STLV2000202/dp/B0CQD48RJS','accessory'],
    ['Grand Theft Auto VI - Digital Edition - PS5 (Code In Box) - Standard',
      'https://app.virginmegastore.ae/en/gaming/playstation-hardware-accessories/playstation-games/grand-theft-auto-vi---digital-edition---ps5-code-in-box---standard/p/1146304','game'],
  ].map(([title,sourceUrl,kind])=>({...base,title,sourceUrl,expectedKind:kind,
    exactMatch:true,matchConfidence:1}));
  for(const source of observed){
    const result=assessOfferMatch('PS5',source);
    assert.equal(result.productKind,source.expectedKind,
      'must classify the physical item itself: '+source.title);
    assert.equal(result.exactMatch,false,
      'console exactMatch must reject accessory/game: '+source.title);
    assert.ok(result.matchConfidence<0.65,'category mismatch cannot be high-confidence');
  }
  const accepted=filterQueryOffers('PS5',[consoleOffer,...observed]);
  assert.ok(accepted.offers.some(o=>o.sourceUrl===consoleOffer.sourceUrl),
    'genuine console remains available');
  assert.ok(accepted.offers.every(o=>!observed.some(item=>item.sourceUrl===o.sourceUrl)),
    'accessory/game must never enter top console results');
});
test('requested PS5 accessories remain discoverable without damaging console bundles',()=>{
  const accessoryTitles=[
    ['PS5 Cooling Fan Horizontal Compatible With PlayStation Console','PS5 cooling fan'],
    ['PS5 Wall Mount for Digital Edition Console','PS5 wall mount'],
    ['Seagate Game Drive for PS5 2TB External HDD','PS5 game drive'],
  ];
  for(const [title,q] of accessoryTitles){
    const offer={...base,title,sourceUrl:'https://example.com/accessory-'+accessoryTitles.indexOf(accessoryTitles.find(x=>x[0]===title))};
    assert.equal(assessOfferMatch(q,offer).productKind,'accessory',title);
    assert.equal(assessOfferMatch('PS5',offer).exactMatch,false);
  }
  for(const title of ['Sony PS5 Slim Console Disc Edition 1TB',
    'Sony PS5 Console Bundle with Disc Drive and Controller 1TB']){
    const matching=assessOfferMatch('PS5', {...base,title});
    assert.equal(matching.productKind,'console',title);
    assert.equal(matching.exactMatch,true,title);
  }
});


test('Arabic and bilingual PS5 listing titles distinguish peripherals and game codes from a complete console',()=>{
  const peripherals=[
    ['غطاء سوني بلايستيشن 5 سليم النسخة الرقمية 825 جيجا','accessory'],
    ['مروحة تبريد لجهاز PS5 Slim Console Digital Edition 825GB','accessory'],
    ['حامل جداري بلايستيشن 5 سليم نسخة الديجيتال 825 جيجا','accessory'],
    ['قارئ أقراص منفصل بلايستيشن 5 رقمي 825 جيجا','accessory'],
    ['هارد خارجي لجهاز PS5 نسخة الأقراص 1TB','accessory'],
    ['قرص صلب خارجي متوافق مع PS5 1TB','accessory'],
    ['لعبة PS5 رقمية كود تحميل 1TB','game'],
    ['شريط لعبة بلايستيشن 5 إصدار رقمي 825 جيجا','game'],
  ];
  const console={...base,title:'جهاز بلايستيشن 5 سليم رقمي 825 جيجا'};
  for(const [title,kind] of peripherals){
    const x={...base,title,sourceUrl:'https://example.com/ps5-arabic-accessory'};
    const parsed=assessOfferMatch('بلايستيشن 5',x);
    assert.equal(parsed.productKind,kind,'product kind must describe item, not console compatibility: '+title);
    assert.equal(parsed.exactMatch,false,'peripheral/game cannot be an exact console: '+title);
    assert.ok(parsed.matchConfidence<0.65,'kind mismatch must demote irrelevant console result: '+title);
    const filtered=filterQueryOffers('بلايستيشن 5',[console,x]);
    assert.ok(filtered.offers.every(o=>o.title!==title),'console search must not include accessory/game: '+title);
  }
  assert.equal(assessOfferMatch('بلايستيشن 5',console).productKind,'console');
  assert.equal(assessOfferMatch('بلايستيشن 5',console).exactMatch,true);
  for(const title of ['جهاز PS5 سليم 1TB مع يد تحكم إضافية Bundle',
    'Sony PS5 Console Bundle with Disc Drive and Controller 1TB']){
    const actual=assessOfferMatch('PS5',{...base,title});
    assert.equal(actual.productKind,'console','complete bundle remains console: '+title);
  }
});

test('Arabic PS5 accessory queries keep intentionally requested peripheral results discoverable',()=>{
  const fixtures=[
    ['غطاء بلايستيشن 5','غطاء PS5 سليم النسخة الرقمية 825 جيجا'],
    ['مروحة تبريد PS5','مروحة تبريد PS5 Slim 825GB'],
    ['حامل جداري PS5','حامل جداري بلايستيشن 5 825 جيجا'],
    ['قارئ اقراص PS5','قارئ أقراص منفصل بلايستيشن 5'],
  ];
  for(const [q,title] of fixtures){
    const record={...base,title};
    assert.equal(parseSearchIntent(q).kind,'accessory','intent must be accessory for '+q);
    assert.equal(assessOfferMatch(q,record).productKind,'accessory','item must be accessory for '+title);
  }
});


test('Arabic iPhone covers are not listed as complete iPhone 17 phones',()=>{
  const phone={...base,title:'Apple iPhone 17 256GB Black',sourceUrl:'https://example.com/iphone17'};
  const cover={...base,title:'غطاء هاتف ايفون 17 اسود',sourceUrl:'https://example.com/iphone17-arabic-cover'};
  for(const query of ['iPhone 17','ايفون 17','iPhone 17 256GB']){
    const result=filterQueryOffers(query,[phone,cover]);
    assert.ok(result.offers.some(x=>x.sourceUrl===phone.sourceUrl),'genuine handset must remain: '+query);
    assert.ok(!result.offers.some(x=>x.sourceUrl===cover.sourceUrl),'phone cover must not be exact: '+query);
    assert.equal(assessOfferMatch(query,cover).exactMatch,false);
  }
});

test('v20 P0 RED: actual Amazon Saudi PS5 vertical stand is a standalone accessory, not an exact console',()=>{
 const stand={...base,
   title:'PS5 Stand Replacement Vertical Stand with Screw for Playstation 5 Console Digital Edition and Disc Version (Vertical Stand)',
   productPrice:80,
   merchant:'Amazon Saudi',
   sourceUrl:'https://www.amazon.sa/-/en/Replacement-Vertical-Playstation-Console-Digital/dp/B09NXT3NMW',
   specs:{modelNumber:'B09NXT3NMW'}};
 const result=assessOfferMatch('PS5',stand);
 assert.equal(result.productKind,'accessory','a sold stand does not become a console through compatibility text');
 assert.equal(result.exactMatch,false,'stand cannot certify PS5 exact console');
 assert.equal(filterQueryOffers('PS5',[consoleOffer,stand]).offers.some(x=>x.sourceUrl===stand.sourceUrl),false);
 assert.equal(assessOfferMatch('PS5 vertical stand',stand).productKind,'accessory');
 assert.equal(filterQueryOffers('PS5 vertical stand',[stand]).offers.length,1,'explicit stand shopper intent must remain discoverable');
 const actualConsole={...base,title:'Sony PS5 Slim Console 1TB with Vertical Stand included'};
 assert.equal(assessOfferMatch('PS5',actualConsole).productKind,'console','genuine console including a stand must remain a console');
 assert.equal(assessOfferMatch('PS5',actualConsole).exactMatch,true);
});
