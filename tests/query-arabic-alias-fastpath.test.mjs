import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSearchQuery,assessOfferMatch} from "../src/search-query.mjs";
import {CURRENT_SOURCE,QUERIES,ungatedBaseline} from "../scripts/legacy-query-alias-baseline.mjs";

const baseline=await ungatedBaseline();
const samples=[
  ...QUERIES,
  ...Array.from({length:120},(_,i)=>"iPhone 17 "+(64+i)+"GB black case "+i),
  ...Array.from({length:120},(_,i)=>"سماعات بلوتوث "+(i%3===0?"JBL":"سوني")+" "+i),
  ...Array.from({length:60},(_,i)=>"PS5 "+(i%2?"Console":"Controller")+" Bundle "+i),
];

test("all 161 reviewed aliases contain Arabic characters: Latin-only fast path has no possible match",()=>{
  const aliasSection=CURRENT_SOURCE.slice(
    CURRENT_SOURCE.indexOf("const ALIASES ="),
    CURRENT_SOURCE.indexOf("const COMPILED_ALIASES ="));
  const aliases=[...aliasSection.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map(x=>x[1]);
  assert.equal(aliases.length,161,"Arabic RAM alias reviewed; new aliases require explicit fast-path safety review");
  assert.ok(aliases.every(alias=>/[\u0600-\u06ff]/u.test(alias)),
    "Latin alias added: ungated evaluation required before release");
});

test("optimized query normalization exactly equals previous full alias scan for 350+ inputs",()=>{
  for(const input of samples){
    assert.equal(normalizeSearchQuery(input),baseline.normalizeSearchQuery(input),
      "normalization drift for "+JSON.stringify(input));
  }
});

test("Arabic-only, mixed-script, Unicode numerals, NFKC and model suffixes preserve legacy behavior",()=>{
  const cases=[
    "آيفون ١٧ ٢٥٦ جيجابايت","سامسونج جالاكسي S25+",
    "بلاي ستيشن ٥ مع يد تحكم اضافيه","اي فون 17 برو",
    "ﻷيفون ١٧","PS5 / controller","Galaxy S25+",
    "IPhone17 512 GB","bluetooth headphones & speakers",
    "إكسسوارات, كفر, شاحن","مُجَدَّد آيفون 17","مستعمل","new","refurbished",
    "a̲ iPhone K","سامسونج Galaxy S25 Ultra 256 جيجا",
  ];
  for(const input of cases)assert.equal(normalizeSearchQuery(input),
    baseline.normalizeSearchQuery(input),input);
});

test("merchant identity/variant decisions remain byte-equivalent with ungated alias evaluation",()=>{
  const offers=[
    {title:"Apple iPhone 17 256GB Black",productType:"phone",brand:"Apple",sourceUrl:"https://fixture.invalid/iphone-17-256gb",specs:{storage:"256GB"}},
    {title:"Apple iPhone 17 Pro 256GB Black",productType:"phone",brand:"Apple",sourceUrl:"https://fixture.invalid/iphone-17-pro-256gb",specs:{storage:"256GB"}},
    {title:"Apple iPhone 17 512GB White",productType:"phone",brand:"Apple",sourceUrl:"https://fixture.invalid/iphone-17-512gb",specs:{storage:"512GB"}},
    {title:"Sony PS5 Console Slim Disc",productType:"console",brand:"Sony",sourceUrl:"https://fixture.invalid/ps5-console"},
    {title:"Sony PS5 Standalone Disc Drive",productType:"accessory",brand:"Sony",sourceUrl:"https://fixture.invalid/ps5-disc-drive"},
    {title:"JBL Bluetooth Headphones",productType:"audio",brand:"JBL",sourceUrl:"https://fixture.invalid/headphones"},
    {title:"JBL Bluetooth Speaker",productType:"audio",brand:"JBL",sourceUrl:"https://fixture.invalid/speaker"},
    {title:"Samsung Galaxy S25 Ultra 512GB",productType:"phone",brand:"Samsung",sourceUrl:"https://fixture.invalid/galaxy-s25-ultra"},
  ];
  for(const query of QUERIES){
    for(const offer of offers){
      assert.deepEqual(assessOfferMatch(query,offer),baseline.assessOfferMatch(query,offer),
        "identity drift for "+JSON.stringify([query,offer.title]));
    }
  }
});

test("ASCII-only normalization still preserves Plus and capacity distinctions",()=>{
  assert.equal(normalizeSearchQuery("Samsung Galaxy S25+"),"samsung galaxy s25 plus");
  assert.equal(normalizeSearchQuery("iPhone 17 256 GB"),"iphone 17 256gb");
  assert.notEqual(normalizeSearchQuery("iPhone 17 Pro"),normalizeSearchQuery("iPhone 17"));
  assert.notEqual(normalizeSearchQuery("iPhone 17 256GB"),normalizeSearchQuery("iPhone 17 512GB"));
});
