import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { resolveProductUrl } from '../server/url-resolver.mjs';

// Selected genuine Schema.org fields observed on Jarir Saudi PDPs 2026-10-20.
// Independent visible price and manufacturer metadata were checked against
// the public PDP; this is a deterministic replay, NOT a live network test.
// Sources:
// https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html
// https://www.jarir.com/sa-en/sony-chroma-pearl-other-gaming-accessories-644723.html
const samples = [
  {
    url:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html',
    observed: { sku:'668751',mpn:'CFI2116B01Y',price:2529,currency:'SAR',type:'PlayStation 5' },
    product: {
      '@type':'Product',
      name:'Sony PlayStation 5 PlayStation 5 Slim (DIG) 825 GB SSD  White - Jarir Bookstore KSA',
      url:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html',
      offers:{'@type':'Offer',url:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html',priceCurrency:'SAR',price:'2529.00',availability:'https://schema.org/InStock',seller:{'@type':'Organization',name:'Jarir Bookstore'}},
      sku:'668751',mpn:'CFI2116B01Y',model:'PlayStation 5 Slim (DIG)',brand:{'@type':'Brand',name:'Sony'},
      additionalProperty:[{'@type':'PropertyValue',name:'Type',value:'PlayStation 5'},{'@type':'PropertyValue',name:'Category',value:'Gaming Consoles and Handheld'}]
    }
  },
  {
    url:'https://www.jarir.com/sa-en/sony-chroma-pearl-other-gaming-accessories-644723.html',
    observed: { sku:'644723',mpn:'590460',price:249,currency:'SAR',type:'Gaming Accessory' },
    product: {
      '@type':'Product',
      name:'Sony Console Covers  Gaming Accessory - Jarir Bookstore KSA',
      url:'https://www.jarir.com/sa-en/sony-chroma-pearl-other-gaming-accessories-644723.html',
      offers:{'@type':'Offer',url:'https://www.jarir.com/sa-en/sony-chroma-pearl-other-gaming-accessories-644723.html',priceCurrency:'SAR',price:'249.00',availability:'https://schema.org/InStock',seller:{'@type':'Organization',name:'Jarir Bookstore'}},
      sku:'644723',mpn:'590460',model:'Console Covers',brand:{'@type':'Brand',name:'Sony'},
      additionalProperty:[{'@type':'PropertyValue',name:'Type',value:'Gaming Accessory'},{'@type':'PropertyValue',name:'Compatibility',value:'for PlayStation 5 Slim Edition (Blu-ray/Digital)'},{'@type':'PropertyValue',name:'Category',value:'Other Gaming Accessories'}]
    }
  }
];

async function replay(product, url, run) {
  const originalFetch=globalThis.fetch,originalLookup=dns.lookup;
  try {
    dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
    const html='<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org/','@graph':[product]})+'</script>';
    globalThis.fetch=async()=>new Response(html,{headers:{'content-type':'text/html'}});
    return await run(url);
  } finally {globalThis.fetch=originalFetch;dns.lookup=originalLookup;}
}

for (const item of samples) {
  test('v21.1 RED: observed Jarir PDP preserves priced product identity and declared type '+item.observed.sku,async()=>{
    await replay(item.product,item.url,async url=>{
      const actual=await resolveProductUrl(url);
      assert.equal(actual.sku,item.observed.sku);
      assert.equal(actual.specs.modelNumber,item.observed.mpn);
      assert.equal(actual.originalProductPrice,item.observed.price);
      assert.equal(actual.originalCurrency,item.observed.currency);
      assert.equal(actual.resolvedPageUrl,url);
      assert.equal(actual.productType,item.observed.type,
        'Schema.org PropertyValue Type on this exact priced PDP must survive canonical resolution');
    });
  });
}

test('v21.1: conflicting or unrelated category metadata must not invent product type',async()=>{
  const base={...samples[1].product};
  base.additionalProperty=[
    {'@type':'PropertyValue',name:'Type',value:'Gaming Accessory'},
    {'@type':'PropertyValue',name:'Type',value:'Gaming Console'},
    {'@type':'PropertyValue',name:'Category',value:'PlayStation 5'}
  ];
  await replay(base,samples[1].url,async url=>{
    const r=await resolveProductUrl(url);
    assert.equal(r.productType,null,'conflicting claimed Types are ambiguous');
  });
});
