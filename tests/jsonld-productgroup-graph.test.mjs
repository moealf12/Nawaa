import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { resolveProductUrl } from "../server/url-resolver.mjs";
import { probeJsonLd } from "../server/source-inspector/probes/jsonld.mjs";

const page="https://fixture.example/products/iphone17";
const graph=(nodes)=>'<script type="application/ld+json">'+JSON.stringify({"@context":"https://schema.org","@graph":nodes})+'</script>';
const of=(id,price,variant)=>({"@type":"Offer","@id":"#"+id,price,priceCurrency:"SAR",url:page+"?variant="+variant});
const group=[
 {"@type":"ProductGroup","@id":"#group",name:"iPhone 17",brand:{"@type":"Brand",name:"Apple"},hasVariant:[{"@id":"#p256"},{"@id":"#p512"}]},
 {"@type":"Product","@id":"#p256",name:"iPhone 17 256GB",sku:"IPH17-256",offers:{"@id":"#offer256"}},
 {"@type":"Product","@id":"#p512",name:"iPhone 17 512GB",sku:"IPH17-512",offers:{"@id":"#offer512"}},
 of("offer256",3199,"256"),
 of("offer512",4199,"512"),
];
async function withHtml(html, fn){
 const original=globalThis.fetch, lookup=dns.lookup;
 try {
  dns.lookup=async()=>[{address:"93.184.216.34",family:4}];
  globalThis.fetch=async()=>new Response(html,{headers:{"content-type":"text/html"}});
  return await fn();
 }finally{globalThis.fetch=original;dns.lookup=lookup;}
}
test("v20.2 RED: @graph ProductGroup may not price generic page by arbitrary sibling",async()=>{
 await withHtml(graph(group),async()=>{
  const r=await resolveProductUrl(page);
  assert.equal(r.originalProductPrice,null,"generic group has two priced variants but no selected item");
  assert.equal(r.productPrice,null);
 });
});
test("v20.2 RED: exact variant URL selects linked Product @id and linked Offer @id",async()=>{
 await withHtml(graph(group),async()=>{
  const r=await resolveProductUrl(page+"?variant=512");
  assert.equal(r.originalProductPrice,4199);
  assert.equal(r.originalCurrency,"SAR");
  assert.equal(r.sku,"IPH17-512");
  assert.equal(r.variantId,"512");
  assert.equal(r.sourceUrl,page+"?variant=512");
 });
});
test("v20.2 RED: inspector resolves an unambiguous same-document Offer @id",()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",sku:"ELITE-840",offers:{"@id":"#offer"}},
  of("offer",4999,"840")
 ]);
 const x=probeJsonLd(html);
 assert.equal(x.pricedProducts,1);
 assert.equal(x.sample[0].price,4999);
 assert.equal(x.sample[0].currency,"SAR");
});
test("v20.2: duplicate conflicting Offer @id cannot establish trusted variant price",async()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",sku:"ELITE-840",offers:{"@id":"#offer"}},
  of("offer",4999,"840"),of("offer",19,"840")
 ]);
 assert.equal(probeJsonLd(html).pricedProducts,0);
 await withHtml(html,async()=>{
  const r=await resolveProductUrl(page);
  assert.equal(r.originalProductPrice,null);
 });
});
test("v20.2: unrelated Offer does not fill missing product price",async()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",sku:"ELITE-840",offers:{"@id":"#never-exists"}},
  of("unrelated",19,"840")
 ]);
 assert.equal(probeJsonLd(html).pricedProducts,0);
 await withHtml(html,async()=>assert.equal((await resolveProductUrl(page)).originalProductPrice,null));
});

test("v20.2 RED: incomplete ProductGroup must not price generic URL via its remaining indexed sibling",async()=>{
 const partial=group.filter(node=>node["@id"]!=="#p512"&&node["@id"]!=="#offer512");
 const html=graph(partial);
 await withHtml(html,async()=>{
  const r=await resolveProductUrl(page);
  assert.equal(r.originalProductPrice,null,
    "incomplete group is not proof the remaining sibling is selected on a generic page");
 });
 const inspected=probeJsonLd(html);
 assert.equal(inspected.pricedProducts,0,
   "source coverage must not certify a partial ProductGroup sibling as the selected offer");
});

test("v20.3 RED: related/recommended JSON-LD Product price cannot replace generic ProductGroup price",async()=>{
 const recommendations=[
  ...group,
  {"@type":"Product","@id":"#recommendation","name":"iPhone 17 Protective Case",
   sku:"CASE-IPH17",offers:{"@type":"Offer",price:49,priceCurrency:"SAR",
     url:page+"/recommendations/case"}}
 ];
 const inspector=probeJsonLd(graph(recommendations));
 assert.equal(inspector.pricedProducts,0,
   "the recommended phone case must not count as the family's trusted item price");
 await withHtml(graph(recommendations),async()=>{
  const generic=await resolveProductUrl(page);
  assert.equal(generic.originalProductPrice,null,
    "do not assign an unrelated cross-sell Product's SAR49 price to iPhone 17 family");
  assert.notEqual(generic.title,"iPhone 17 Protective Case");
  const explicit=await resolveProductUrl(page+"?variant=512");
  assert.equal(explicit.originalProductPrice,4199);
  assert.equal(explicit.sku,"IPH17-512");
 });
});

test("v20.4 RED: same-page absolute @id and fragment @id resolve the explicitly requested variant",async()=>{
 const mixed=group.map(node=>({...node,
   "@id":String(node["@id"]||"").startsWith("#")?page+node["@id"]:node["@id"]}));
 const html=graph(mixed);
 await withHtml(html,async()=>{
  const resolved=await resolveProductUrl(page+"?variant=512");
  assert.equal(resolved.sku,"IPH17-512");
  assert.equal(resolved.originalProductPrice,4199);
  assert.equal(resolved.sourceUrl,page+"?variant=512");
 });
 const inspected=probeJsonLd(graph([
  {"@type":"Product","@id":page+"#single",name:"HP EliteBook 840 G10",
    offers:{"@id":"#specific-offer"}},
  {"@type":"Offer","@id":page+"#specific-offer",price:4999,priceCurrency:"SAR"}
 ]),page);
 assert.equal(inspected.pricedProducts,1);
 assert.equal(inspected.sample[0].price,4999);
});

test("v20.4 RED: equivalent absolute and fragment ids with conflicting prices are ambiguous",async()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",
    offers:{"@id":"#offer"}},
  {"@type":"Offer","@id":"#offer",price:4999,priceCurrency:"SAR"},
  {"@type":"Offer","@id":page+"#offer",price:19,priceCurrency:"SAR"}
 ]);
 assert.equal(probeJsonLd(html,page).pricedProducts,0);
 await withHtml(html,async()=>{
  const resolved=await resolveProductUrl(page);
  assert.equal(resolved.originalProductPrice,null,
    "ambiguous duplicate @id must not become an exact purchasable price");
 });
});

test("v20.4: off-page absolute @id must not borrow a same-fragment local offer",async()=>{
 const html=graph([
  {"@type":"Product","@id":"#p",name:"HP EliteBook 840 G10",
    offers:{"@id":"https://foreign.example/another-product#price"}},
  {"@type":"Offer","@id":"#price",price:1999,priceCurrency:"SAR"}
 ]);
 assert.equal(probeJsonLd(html,page).pricedProducts,0);
 await withHtml(html,async()=>{
  assert.equal((await resolveProductUrl(page)).originalProductPrice,null);
 });
});

test("v20.5 RED: recommended foreign-page ProductGroup cannot replace current PDP Product",async()=>{
 const html=graph([
   {"@type":"ProductGroup","@id":"https://fixture.example/recommendations/phone#group",
    url:"https://fixture.example/recommendations/phone",name:"Recommended Phone Case Family",
    hasVariant:[{"@id":"https://fixture.example/recommendations/phone#case"}]},
   {"@type":"Product","@id":"#main",url:page,name:"HP EliteBook 840 G10",
    sku:"HP840G10",offers:{"@type":"Offer",price:4999,priceCurrency:"SAR",url:page}}
 ]);
 const inspector=probeJsonLd(html,page);
 assert.equal(inspector.pricedProducts,1,
   "an unrelated ProductGroup on a recommendation page must not mask the current page's product price");
 assert.equal(inspector.sample[0].title,"HP EliteBook 840 G10");
 await withHtml(html,async()=>{
   const actual=await resolveProductUrl(page);
   assert.equal(actual.originalProductPrice,4999);
   assert.equal(actual.sku,"HP840G10");
   assert.equal(actual.title,"HP EliteBook 840 G10");
 });
});

test("v20.5 RED: recommendation group with local @id but explicit off-page url is not main PDP",async()=>{
 const html=graph([
   {"@type":"ProductGroup","@id":"#recommended-group",
    url:"https://fixture.example/recommendations/phone",name:"Recommended Accessory Group",
    hasVariant:[{"@id":"#absent"}]},
   {"@type":"Product",name:"HP EliteBook 840 G10",url:page,
    sku:"HP840G10",offers:{"@type":"Offer",price:4999,priceCurrency:"SAR",url:page}}
 ]);
 assert.equal(probeJsonLd(html,page).pricedProducts,1);
 await withHtml(html,async()=>{
   const actual=await resolveProductUrl(page);
   assert.equal(actual.originalProductPrice,4999);
   assert.equal(actual.title,"HP EliteBook 840 G10");
 });
});
