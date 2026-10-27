import test from 'node:test';
import assert from 'node:assert/strict';
import { searchFreeStorefrontById } from '../server/providers/free-storefronts.mjs';
import { sourceReliability } from '../server/source-reliability.mjs';

// Synthetic, isolated source content. No merchant requests, credentials, FX
// traffic or invented public product listings.
const storeId = 'asos-global';
const query = 'nike air max';
const title = 'Nike Air Max Running Shoes';
const validPdp = 'https://www.asos.com/prd/123456789';

async function offersFromJsonLd(sourceUrl, { arrayOffers = false } = {}) {
  const originalFetch = globalThis.fetch;
  sourceReliability.reset(storeId);
  try {
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      assert.equal(new URL(String(input)).hostname, 'www.asos.com',
        'fixture must never request a product page or another host');
      const data = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: title,
        url: sourceUrl,
        sku: 'SHOE-123',
        offers: arrayOffers
          ? [{ '@type': 'Offer', price: '175', priceCurrency: 'SAR' }]
          : { '@type': 'Offer', price: '175', priceCurrency: 'SAR' }
      };
      return new Response(
        '<html><head><script type="application/ld+json">' +
        JSON.stringify(data) + '</script></head><body>Search result</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    };
    const result = await searchFreeStorefrontById(storeId, query, { perStore: 3 });
    assert.equal(calls, 1, 'search-card structured data must not trigger a PDP fetch');
    return result.offers;
  } finally {
    globalThis.fetch = originalFetch;
    sourceReliability.reset(storeId);
  }
}

test('RED: cross-merchant JSON-LD offer cannot inherit the searched merchant identity', async () => {
  const offers = await offersFromJsonLd('https://unrelated.example/prd/123456789');
  assert.deepEqual(offers, [], 'foreign URLs must never become ASOS offers');
});

test('RED: a same-domain non-product path is not a source-verified sale listing', async () => {
  const offers = await offersFromJsonLd('https://www.asos.com/landing/sale');
  assert.deepEqual(offers, [], 'source productPath is an existing ownership gate');
});

test('RED: a non-HTTPS JSON-LD product link is not a verified merchant destination', async () => {
  const offers = await offersFromJsonLd('http://www.asos.com/prd/123456789');
  assert.deepEqual(offers, [], 'search structured offers must retain HTTPS-only destinations');
});

test('positive control: same-merchant HTTPS product record remains a comparable offer', async () => {
  const offers = await offersFromJsonLd(validPdp);
  assert.equal(offers.length, 1, 'valid structured product should not be lost');
  assert.equal(offers[0].sourceUrl, validPdp);
  assert.equal(offers[0].merchant, 'ASOS');
  assert.equal(offers[0].productPrice, 175);
});

test('positive control: JSON-LD Offer arrays resolve the same source-owned product without embedded extraction', async () => {
  const offers = await offersFromJsonLd(validPdp, { arrayOffers: true });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].sourceUrl, validPdp);
  assert.equal(offers[0].productPrice, 175);
});

test('positive control: relative same-merchant PDP remains valid', async () => {
  const offers = await offersFromJsonLd('/prd/123456789', { arrayOffers: true });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].sourceUrl, validPdp);
});

test('negative controls: structured offers reject URL credentials and non-standard ports', async () => {
  for (const url of [
    'https://user:pass@www.asos.com/prd/123456789',
    'https://www.asos.com:8443/prd/123456789'
  ]) {
    const offers = await offersFromJsonLd(url, { arrayOffers: true });
    assert.deepEqual(offers, [], url);
  }
});
