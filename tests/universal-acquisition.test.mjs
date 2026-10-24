import test from "node:test";
import assert from "node:assert/strict";
import { toNawaaProduct } from "../server/nawaa-extractor.mjs";

test("Crawlee fallback-shaped offers map into NAWAA product schema",()=>{
  const offer={
    title:"HP Pavilion 14",
    image:"https://example.com/p.jpg",
    productPrice:2499,
    originalProductPrice:2699,
    originalCurrency:"SAR",
    availability:"in_stock",
    sourceUrl:"https://example.com/p/1",
    specs:{brand:"HP",modelNumber:"14-ew"},
    extraction:{crawlee:true,strategy:"json_ld",jsonLdProductFound:true}
  };
  const product=toNawaaProduct(offer,offer.sourceUrl);
  assert.equal(product.identity.brand,"HP");
  assert.equal(product.commerce.priceSAR,2499);
  assert.equal(product.source.canonicalUrl,offer.sourceUrl);
  assert.ok(product.quality.confidence>=0.6);
});

// v21.56 tooling audit: deterministic RED-first tests for cross-field ownership.
// A coherent source record is required; valid scalar fields cannot be combined
// across unrelated sellable products to mint a new price or SKU.
import fc from 'fast-check';
import {reconcile,extractDiscoveredProductUrls} from '../server/universal-acquisition.mjs';
const fallbackChecks={seed:2146,numRuns:64};
const fallbackUrl='https://merchant.example/p/laptop';

test('property: a price may never borrow currency from a different source record',()=>{
  fc.assert(fc.property(
    fc.integer({min:100,max:100000}),
    fc.integer({min:100,max:100000}),
    fc.constantFrom('SAR','USD','AED'),
    (orphanPrice,completePrice,currency)=>{
      const extracted=reconcile([
        {method:'json_ld',title:'Laptop A',price:orphanPrice,currency:null,
          sku:'SKU-A',image:'https://merchant.example/a.jpg',brand:'A',availability:'in_stock'},
        {method:'structured_meta',title:'Laptop B',price:completePrice,currency,
          sku:'SKU-B',availability:'unknown'},
      ],fallbackUrl);
      assert.equal(extracted.productPrice,completePrice);
      assert.equal(extracted.originalCurrency,currency);
      assert.equal(extracted.title,'Laptop B');
      assert.equal(extracted.sku,'SKU-B');
      assert.equal(extracted.extraction.fieldSources.price,extracted.extraction.fieldSources.currency);
    }),fallbackChecks);
});

test('property: evidence split between price-only and currency-only cannot create an offer',()=>{
  fc.assert(fc.property(fc.integer({min:1,max:100000}),
    fc.constantFrom('SAR','USD','AED'),(price,currency)=>{
      assert.throws(()=>reconcile([
        {method:'json_ld',title:'Laptop A',price,currency:null,sku:'SKU-A'},
        {method:'structured_meta',title:'Laptop B',price:null,currency,sku:'SKU-B'},
      ],fallbackUrl),/coherent|structured product evidence/i);
    }),fallbackChecks);
});

test('property: an unrelated product cannot supply missing SKU or image to a priced offer',()=>{
  fc.assert(fc.property(fc.integer({min:1,max:100000}),fc.integer({min:1,max:99999}),
    (price,otherSku)=>{
      const extracted=reconcile([
        {method:'json_ld',title:'Laptop A',price,currency:'SAR',sku:null,image:null},
        {method:'structured_meta',title:'Accessory B',price:null,currency:null,
          sku:'FOREIGN-'+otherSku,image:'https://merchant.example/accessory.jpg'},
      ],fallbackUrl);
      assert.equal(extracted.productPrice,price);
      assert.equal(extracted.sku,null);
      assert.equal(extracted.image,null);
    }),fallbackChecks);
});

test('positive control: a complete JSON-LD offer keeps its own price currency SKU and image',()=>{
  const extracted=reconcile([
    {method:'json_ld',title:'Laptop A',price:2499,currency:'SAR',sku:'LAP-14',
      image:'https://merchant.example/laptop.jpg',availability:'in_stock'},
    {method:'structured_meta',title:'Laptop A',price:null,currency:null,
      sku:'LAP-14'},
  ],fallbackUrl);
  assert.equal(extracted.title,'Laptop A');
  assert.equal(extracted.productPrice,2499);
  assert.equal(extracted.originalCurrency,'SAR');
  assert.equal(extracted.sku,'LAP-14');
  assert.equal(extracted.image,'https://merchant.example/laptop.jpg');
});

test('positive control: matching explicit SKU can enrich a missing image without changing the owned price',()=>{
  const extracted=reconcile([
    {method:'json_ld',title:'Laptop A',price:2499,currency:'SAR',sku:'LAP-14'},
    {method:'structured_meta',title:'Laptop A',price:null,currency:null,sku:'LAP-14',
      image:'/laptop-a.jpg'},
  ],fallbackUrl);
  assert.equal(extracted.productPrice,2499);
  assert.equal(extracted.originalCurrency,'SAR');
  assert.equal(extracted.image,'https://merchant.example/laptop-a.jpg');
  assert.equal(extracted.extraction.fieldSources.image,'structured_meta');
  assert.equal(extracted.extraction.fieldSources.price,'json_ld');
});

test('adversarial: even matching SKU cannot override a contradictory model number',()=>{
  const extracted=reconcile([
    {method:'json_ld',title:'Laptop A',price:2499,currency:'SAR',sku:'SKU-14',
      modelNumber:'MODEL-14',image:null},
    {method:'structured_meta',title:'Unrelated Accessory',price:null,currency:null,
      sku:'SKU-14',modelNumber:'MODEL-OTHER',image:'/foreign.jpg'},
  ],fallbackUrl);
  assert.equal(extracted.productPrice,2499);
  assert.equal(extracted.modelNumber,'MODEL-14');
  assert.equal(extracted.image,null);
});

test('adversarial: malformed or missing currency is not a sellable priced offer',()=>{
  for(const currency of [null,'', 'SAR USD', 'SAR!', '1234']){
    assert.throws(()=>reconcile([{method:'json_ld',title:'Laptop A',
      price:2499,currency}],fallbackUrl),/coherent structured product evidence/);
  }
});


test('v21.72 fallback: a shared model number cannot donate sibling variant image without SKU or GTIN',()=>{
  fc.assert(fc.property(
    fc.integer({min:100,max:99000}),
    fc.constantFrom('8GB','16GB','32GB'),
    (price,siblingRam)=>{
      const extracted=reconcile([
        {method:'json_ld',title:'HP Laptop 8GB',price,currency:'SAR',
          sku:'LAPTOP-8GB',modelNumber:'SHARED-FAMILY',image:null},
        {method:'structured_meta',title:'HP Laptop '+siblingRam,price:null,
          currency:null,sku:null,modelNumber:'SHARED-FAMILY',
          image:'/sibling-'+siblingRam+'.jpg'},
      ],fallbackUrl);
      assert.equal(extracted.title,'HP Laptop 8GB');
      assert.equal(extracted.productPrice,price);
      assert.equal(extracted.sku,'LAPTOP-8GB');
      assert.equal(extracted.image,null,
        'model-only sibling cannot contribute product media');
    }),{seed:2172,numRuns:64});
});

test('v21.72 fallback: hard-SKU punctuation remains identity-bearing during enrichment',()=>{
  fc.assert(fc.property(
    fc.constantFrom('+','-','_','.'),
    fc.integer({min:1,max:9999}),
    (separator,n)=>{
      const sku='MODEL'+separator+n,collidingSku='MODEL'+n;
      const extracted=reconcile([
        {method:'json_ld',title:'Selected Sellable Product',price:2499,
          currency:'SAR',sku,modelNumber:'MODEL-FAMILY',image:null},
        {method:'structured_meta',title:'Nearby Accessory',price:null,
          currency:null,sku:collidingSku,modelNumber:'MODEL-FAMILY',
          image:'/foreign-accessory.jpg'},
      ],fallbackUrl);
      assert.equal(extracted.sku,sku);
      assert.equal(extracted.image,null,'punctuation loss must not create source authority');
      const genuine=reconcile([
        {method:'json_ld',title:'Selected Sellable Product',price:2499,
          currency:'SAR',sku,modelNumber:'MODEL-FAMILY',image:null},
        {method:'structured_meta',title:'Same Product',price:null,
          currency:null,sku,modelNumber:'MODEL-FAMILY',image:'/owned.jpg'}
      ],fallbackUrl);
      assert.equal(genuine.image,'https://merchant.example/owned.jpg',
        'genuine exact SKU must preserve useful enrichment');
    }),{seed:2173,numRuns:64});
});

test('v21.72 fallback positive: matching explicit GTIN supports a limited enrichment when SKU is unavailable',()=>{
  const extracted=reconcile([
    {method:'json_ld',title:'Source-owned Product',price:1999,
      currency:'SAR',sku:null,gtin:'0123456789012',image:null},
    {method:'structured_meta',title:'Source-owned Product',price:null,
      currency:null,sku:null,gtin:'0123456789012',image:'/source-owned.jpg'},
  ],fallbackUrl);
  assert.equal(extracted.productPrice,1999);
  assert.equal(extracted.image,'https://merchant.example/source-owned.jpg');
});

test('v21.74 discovery: distinct selected-SKU links are not deduplicated',()=>{
  const html='<a href="/p.html?sku=123">a</a><a href="/p.html?sku=456">b</a>';
  assert.deepEqual(extractDiscoveredProductUrls(html,'https://shop.example/catalog.html'),[
    'https://shop.example/p.html?sku=123',
    'https://shop.example/p.html?sku=456'
  ]);
});

test('v21.74 discovery: tracking-only duplicates do not starve other products',()=>{
  const html='<a href="/p.html?sku=123&utm_source=one">a</a>'+
    '<a href="/p.html?sku=123&utm_source=two">duplicate</a>'+
    '<a href="/p.html?sku=456">b</a>';
  assert.deepEqual(extractDiscoveredProductUrls(html,'https://shop.example/list.html',{limit:2}),[
    'https://shop.example/p.html?sku=123&utm_source=one',
    'https://shop.example/p.html?sku=456'
  ]);
});

test('v21.74 discovery: repeated source selector order is identity-relevant',()=>{
  const html='<a href="/p.html?option=a&option=b">a</a>'+
    '<a href="/p.html?option=b&option=a">b</a>'+
    '<a href="/p.html?option=a&option=b#reviews">duplicate fragment</a>';
  assert.deepEqual(extractDiscoveredProductUrls(html,'https://shop.example/list.html'),[
    'https://shop.example/p.html?option=a&option=b',
    'https://shop.example/p.html?option=b&option=a'
  ]);
});

test('v21.74 discovery: reject invalid transport links and out-of-host results',()=>{
  const html=[
    '<a href="/valid.html">good</a>',
    '<a href="http://shop.example/no.html">http</a>',
    '<a href="https://user:pass@shop.example/no.html">creds</a>',
    '<a href="https://shop.example:8443/no.html">port</a>',
    '<a href="https://evil.example/no.html">cross-host</a>',
    '<a href="javascript:alert(1)">script</a>',
    '<a href="https://shop.example/not-a-product.pdf">not html</a>'
  ].join('');
  assert.deepEqual(extractDiscoveredProductUrls(html,'https://shop.example/list.html',{
    allowedHost:'shop.example'}),['https://shop.example/valid.html']);
});

test('v21.74 discovery: selected-host redirect mismatch fails closed',()=>{
  assert.throws(()=>extractDiscoveredProductUrls(
    '<a href="/p.html">x</a>','https://elsewhere.example/list.html',
    {allowedHost:'shop.example'}),/redirected beyond/);
});

test('v21.74 discovery: final resolved base and bounded cap remain correct',()=>{
  const html='<a href="./first.html">first</a><a href="./second.html">second</a>';
  assert.deepEqual(extractDiscoveredProductUrls(html,
    'https://shop.example/catalog/index.html',{limit:1}),[
      'https://shop.example/catalog/first.html'
    ]);
});

test('v21.74 discovery: malformed or over-budget HTML fails closed',()=>{
  assert.throws(()=>extractDiscoveredProductUrls(null,'https://shop.example/list.html'),/body budget/);
  assert.throws(()=>extractDiscoveredProductUrls('x'.repeat(8_000_001),
    'https://shop.example/list.html'),/body budget/);
});
