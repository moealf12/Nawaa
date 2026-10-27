import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDomainProduct } from '../server/domain-adapters.mjs';
import { extractionCandidates } from '../server/url-resolver.mjs';

const url='https://www.lookfantastic.com/p/cerave-sa-smoothing-cleanser-with-salicylic-acid-for-dry-rough-bumpy-skin-236ml/12207663/';
const title='CeraVe SA Smoothing Cleanser with Salicylic Acid for Dry, Rough & Bumpy Skin 236ml';
const meta='<meta property="og:image" content="https://static.lookfantastic.com/cerave-236ml.jpg">' +
  '<meta property="og:title" content="'+title+'">';
const html=(body)=>'<html><head>'+meta+'</head><body><main>' +
  '<h1>'+title+'</h1>'+body+'</main></body></html>';
const purchase='<button>ADD TO BASKET</button>';
const current=(p)=>'<section class="price-block"><span>Current price:</span><strong>&pound;'+p+'</strong></section>';

test('RED: only explicitly labelled current product price becomes Lookfantastic GBP Offer',()=>{
  const markup=html(
    '<div>Recommended Retail Price: &pound;14.50</div>'+
    current('10.88')+
    '<div>236ml &pound;14.50 &pound;10.88 | 473ml &pound;23.50 &pound;17.63</div>'+
    '<p>Or 4 interest-free payments of &pound;2.72</p>'+purchase);
  const found=extractDomainProduct(url,markup);
  assert.ok(found,'source-specific current-price evidence should be parsed');
  assert.equal(found.adapterId,'lookfantastic');
  assert.equal(found.product.name,title);
  assert.equal(found.product.offers.price,10.88);
  assert.equal(found.product.offers.priceCurrency,'GBP');
  assert.equal(found.product.sku,'12207663');
  const strategies=extractionCandidates(markup,url);
  assert.ok(strategies.some(x=>x.strategy==='domain_adapter'&&x.product.offers.price===10.88),
    'resolver must receive only the source-owned current price');
});

test('negative: RRP, instalment amounts and variant-selection option prices are not purchasable fallback prices',()=>{
  const markup=html('<p>Recommended Retail Price: &pound;14.50</p>'+
    '<p>236ml &pound;10.88 473ml &pound;17.63</p>'+
    '<p>Pay in 4 interest free payments of &pound;2.72</p>'+purchase);
  assert.equal(extractDomainProduct(url,markup),null);
});

test('negative: unrelated recommendation after checkout is not the queried product current price',()=>{
  const markup=html('<p>Current offer unavailable</p>'+purchase+
    '<div class="recommendation">Current price: &pound;3.99</div>');
  assert.equal(extractDomainProduct(url,markup),null);
});

test('negative: scripts and hidden injected payloads do not authorize a GBP price',()=>{
  const markup=html('<script>window.fake="Current price: &pound;0.99"</script>'+
    '<div hidden>Current price: &pound;1.25</div>'+
    '<p>Recommended Retail Price &pound;14.50</p>'+purchase);
  assert.equal(extractDomainProduct(url,markup),null);
});

test('negative: disagreeing current-price labels must fail closed',()=>{
  const markup=html(current('10.88')+current('17.63')+purchase);
  assert.equal(extractDomainProduct(url,markup),null);
});

test('negative: variant-specific Lookfantastic URL cannot inherit price of a different selection',()=>{
  const markup=html(current('10.88')+purchase);
  assert.equal(extractDomainProduct(url+'?variation=13441813',markup),null);
  assert.equal(extractDomainProduct(url+'?variation=12207663',markup)?.product.offers.price,10.88);
});

test('negative: outside merchant product paths and non-GBP currency must not infer a source price',()=>{
  const markup=html(current('10.88')+purchase);
  assert.equal(extractDomainProduct('https://unrelated.example/p/a/12207663/',markup),null);
  assert.equal(extractDomainProduct('https://www.lookfantastic.com/search?query=cerave',markup),null);
  assert.equal(extractDomainProduct(url,html('<p>Current price: €10.88</p>'+purchase)),null);
});
