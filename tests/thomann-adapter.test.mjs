import test from "node:test";
import assert from "node:assert/strict";
import {extractThomannProduct,isThomannProductUrl} from "../server/thomann-adapter.mjs";
import {extractionCandidates} from "../server/url-resolver.mjs";

const url=name=>"https://www.thomann.de/de/"+name;
const html=(title,price,more="")=>
  '<html><head><meta property="og:image" content="https://thumbs.static-thomann.de/pics/153257.jpg"></head>'+
  '<body><main><h1>'+title+'</h1><p>Artikelnummer 153257</p>'+
  more+'<p>'+price+' €</p><p>Alle Preise inkl. MwSt.</p>'+
  '<button>In den Warenkorb</button><aside>Accessory 2 €</aside></main></body></html>';

test("Thomann URL provenance: exact HTTPS German product only",()=>{
  assert.equal(isThomannProductUrl(url("akg_k_240_studio_kopfhoerer.htm")+"?type=quickSearch"),true);
  for(const invalid of [
    "https://www.thomann.de.evil.example/de/akg_k_240_studio_kopfhoerer.htm",
    "https://evil@www.thomann.de/de/akg_k_240_studio_kopfhoerer.htm",
    "http://www.thomann.de/de/akg_k_240_studio_kopfhoerer.htm",
    "https://www.thomann.de/de/search_dir.html?sw=studio",
    "https://www.thomann.de/gb/akg_k_240_studio_kopfhoerer.htm"
  ])assert.equal(isThomannProductUrl(invalid),false,invalid);
});

test("Three documented product shapes: main EUR price survives B-Stock and MSRP",()=>{
  for(const [path,title,price] of [
    ["akg_k_240_studio_kopfhoerer.htm","AKG K-240 Studio Kopfhörer",68],
    ["vic_firth_sih3_headphones.htm","Vic Firth SIH3 Headphones",92],
    ["akg_k_361.htm","AKG K-361",94]
  ]){
    const document=html(title,price,'<a>B-Stock ab 63 € verfügbar</a><span>-48% UVP: 130,65 €</span>');
    const product=extractThomannProduct(document,url(path));
    assert.equal(product?.name,title);
    assert.equal(product?.offers?.price,price);
    assert.equal(product?.offers?.priceCurrency,"EUR");
    assert.equal(product?.sku,"153257");
    const candidates=extractionCandidates(document,url(path));
    assert.deepEqual(candidates.map(c=>c.strategy),["domain_adapter"]);
    assert.equal(candidates[0]?.adapterId,"thomann");
  }
});
test("German thousands and decimal separator",()=>{
  const doc=html("Studio Equipment","1.299,90",
    '<span>UVP: 1.599,00 €</span><a>B-Stock ab 1.100,00 € verfügbar</a>');
  assert.equal(extractThomannProduct(doc,url("studio_equipment.htm"))?.offers?.price,1299.9);
});
test("B-Stock / UVP alone must not become standard offer",()=>{
  const doc=html("AKG K-240 Studio Kopfhörer","",
    '<a>B-Stock ab 63 € verfügbar</a><span>UVP: 130,65 €</span>');
  assert.equal(extractThomannProduct(doc,url("akg_k_240_studio_kopfhoerer.htm")),null);
  assert.deepEqual(extractionCandidates(doc,url("akg_k_240_studio_kopfhoerer.htm")),[]);
});
test("Contradictory current prices are rejected",()=>{
  assert.equal(extractThomannProduct(html("Studio Headphones",68,"<p>69 €</p>"),
    url("studio_headphones.htm")),null);
});
test("Recommendations and JSON-LD cross-sell are not the main PDP offer",()=>{
  const doc='<html><head><meta property="og:image" content="https://thumbs.static-thomann.de/p.jpg"></head>'+
    '<body><main><h1>Studio Headphones</h1><div class="recommendations">3 € Alle Preise inkl. MwSt.</div>'+
    '<script type="application/ld+json">{"@type":"Product","name":"Other item","offers":{"price":"2","priceCurrency":"EUR"}}</script>'+
    '</main></body></html>';
  assert.deepEqual(extractionCandidates(doc,url("studio_headphones.htm")),[]);
});
test("Currency, VAT anchor, heading and merchant image are mandatory",()=>{
  const doc=html("Studio Headphones",68);
  for(const broken of [
    doc.replace("68 €","68"),
    doc.replace("Alle Preise inkl. MwSt.","Prices exclude VAT"),
    doc.replace("<h1>Studio Headphones</h1>",""),
    doc.replace("thumbs.static-thomann.de","attacker.invalid")
  ])assert.equal(extractThomannProduct(broken,url("studio_headphones.htm")),null);
});
test("Other merchants cannot call Thomann extractor",()=>{
  assert.equal(extractThomannProduct(html("Studio Headphones",68),
    "https://www.amazon.de/dp/B012345678"),null);
});
