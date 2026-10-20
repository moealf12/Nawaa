import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAliExpressSearchOffers } from '../server/providers/free-storefronts.mjs';

// RECORDED_REAL_REPLAY of the customer-observed product-link class:
// on historical Chromium #39461330015, an AliExpress charger or adaptor
// listed for iPhone17 linked to /ssr/300000512/BundleDeals2 instead of a PDP.
// Synthetic embedded-state wrappers isolate the real product-link failure:
// neither the mock prices nor IDs certify a currently live merchant product.
function embed({id='1005007112345678',link,title='iPhone 17 protective case',currency='SAR',price=29.5}={}){
  return '{"redirectedId":"'+id+'","itemType":"productV3","productId":"'+id+'","title":{"displayTitle":'+JSON.stringify(title)+'},"image":{"imgUrl":"https://ae01.alicdn.com/kf/example.jpg"},"salePrice":{"currencyCode":"'+currency+'","minPrice":'+price+'},"productDetailUrl":'+JSON.stringify(link)+'}';
}

test('v21.5 RED — a generic AliExpress promotion page must never represent a priced PDP offer',()=>{
  const input=embed({link:'https://www.aliexpress.com/ssr/300000512/BundleDeals2'});
  assert.equal(extractAliExpressSearchOffers(input,'iPhone 17').length,0,
    'observed BundleDeals2 landing URL is not an identified purchasable item');
});

test('v21.5 — accept product-specific HTTPS URL and preserve actual tracking parameters',()=>{
  const id='1005007112345678';
  const link='https://www.aliexpress.com/item/'+id+'.html?spm=a2g0o.productlist.0.0&gatewayAdapt=glo2usa';
  const found=extractAliExpressSearchOffers(embed({id,link}),'iPhone 17');
  assert.equal(found.length,1);
  assert.equal(found[0].productId,id);
  assert.equal(found[0].sourceUrl,link);
  assert.equal(found[0].price,29.5);
  assert.equal(found[0].currency,'SAR');
});

test('v21.5 — support real item relative URL without inventing a different item identifier',()=>{
  const id='1005007112345678';
  const got=extractAliExpressSearchOffers(embed({id,link:'/item/'+id+'.html?foo=1'}),'iPhone 17');
  assert.equal(got.length,1);
  assert.equal(got[0].sourceUrl,'https://www.aliexpress.com/item/'+id+'.html?foo=1');
});

test('v21.5 — reject spoofed hosts, insecure links and mismatched product IDs',()=>{
  const id='1005007112345678';
  const bad=[
    'https://www.aliexpress.com/ssr/300000512/BundleDeals2',
    'https://www.aliexpress.com/w/wholesale-iphone-17.html',
    'https://www.aliexpress.com/category/100003109/cellphones.html',
    'https://www.aliexpress.com/item/1005007112345679.html',
    'http://www.aliexpress.com/item/'+id+'.html',
    'https://www.aliexpress.com.evil.example/item/'+id+'.html',
    'https://not-aliexpress.example/item/'+id+'.html',
    'https://alice:secret@www.aliexpress.com/item/'+id+'.html',
    'javascript:alert(1)',
  ];
  for(const link of bad){
    const found=extractAliExpressSearchOffers(embed({id,link}),'iPhone 17');
    assert.equal(found.length,0,link);
  }
});

test('v21.5 — two different product IDs cannot claim one merchant item URL',()=>{
  const id='1005007112345678';
  const source=embed({id,link:'https://www.aliexpress.com/item/'+id+'.html'})+
    embed({id:'1005007112345679',link:'https://www.aliexpress.com/item/'+id+'.html'});
  const got=extractAliExpressSearchOffers(source,'iPhone 17');
  assert.deepEqual(got.map(x=>x.productId),[id]);
});
