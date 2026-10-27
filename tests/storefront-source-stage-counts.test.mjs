import test from 'node:test';
import assert from 'node:assert/strict';
import { searchFreeStorefrontById, searchFreeStorefronts, routeFreeStorefronts } from '../server/providers/free-storefronts.mjs';
import { sourceReliability } from '../server/source-reliability.mjs';

const storeId = 'asos-global';
const query = 'nike air max';
const documents = [
  { '@type': 'Product', name: 'Nike Air Max Running Shoes', url: 'https://www.asos.com/prd/123456789', offers: { price: 175, priceCurrency: 'SAR' } },
  { '@type': 'Product', name: 'Sony PlayStation 5 Console', url: 'https://www.asos.com/prd/987654321', offers: { price: 299, priceCurrency: 'SAR' } },
];
const html = '<html><script type="application/ld+json">' + JSON.stringify(documents) + '</script></html>';

async function fixtureSearch(markup) {
  const originalFetch = globalThis.fetch;
  sourceReliability.reset(storeId);
  try {
    let requests = 0;
    globalThis.fetch = async input => {
      requests++;
      assert.equal(new URL(String(input)).hostname, 'www.asos.com', 'test must stay inside one synthetic search page');
      return new Response(markup, { status: 200, headers: { 'content-type':'text/html' } });
    };
    const result = await searchFreeStorefrontById(storeId, query, { perStore: 3 });
    assert.equal(requests, 1, 'structured search results must not fan out to live PDPs');
    return result;
  } finally {
    globalThis.fetch = originalFetch;
    sourceReliability.reset(storeId);
  }
}

test('RED: expose loss accounting between structured extraction, price normalization, matching and selection', async () => {
  const result = await fixtureSearch(html);
  const stages = result.diagnostics?.sourceStageCounts;
  assert.ok(stages, 'sourceStageCounts must be present even for successful storefront searches');
  assert.equal(stages.structuredCandidates, 2);
  assert.equal(stages.productPagesRequested, 0, 'verified structured search cards do not trigger PDP lookups');
  assert.equal(stages.productPagesPriced, 0);
  assert.equal(stages.productPagesFailed, 0);
  assert.equal(stages.structuredFxRejected, 0);
  assert.equal(stages.preMatchOffers, 2);
  assert.equal(stages.relevanceRejected + stages.relevanceRetained, stages.preMatchOffers);
  assert.equal(stages.relevanceRetained, stages.emittedOffers + stages.selectionTruncated);
  assert.equal(stages.emittedOffers, result.offers.length);
  assert.ok(stages.relevanceRejected >= 1, 'irrelevant PlayStation result must not become a Nike offer');
});

test('RED: legitimate empty search reports zero stages, not an imagined extraction or price failure', async () => {
  const result = await fixtureSearch('<html><body>No relevant products</body></html>');
  const stages = result.diagnostics?.sourceStageCounts;
  assert.ok(stages);
  assert.equal(stages.structuredCandidates, 0);
  assert.equal(stages.productLinkCandidates, 0);
  assert.equal(stages.productPagesRequested, 0);
  assert.equal(stages.preMatchOffers, 0);
  assert.equal(stages.relevanceRejected, 0);
  assert.equal(stages.emittedOffers, 0);
});

test('RED: public aggregate diagnostics carry counts without merchant URLs or price contents', async () => {
  const offset = routeFreeStorefronts(query, Infinity, { stable: true })
    .findIndex(route => route.store.id === storeId);
  assert.ok(offset >= 0);
  const oldFetch = globalThis.fetch;
  sourceReliability.reset(storeId);
  try {
    globalThis.fetch = async input => {
      assert.equal(new URL(String(input)).hostname, 'www.asos.com');
      return new Response(html, { status: 200, headers: { 'content-type':'text/html' } });
    };
    const result = await searchFreeStorefronts(query, { stableRouting: true, storeOffset: offset, storeLimit: 1, productPageLimit: 3 });
    assert.equal(result.diagnostics.length, 1);
    const stages = result.diagnostics[0].sourceStageCounts;
    assert.ok(stages);
    assert.equal(stages.structuredCandidates, 2);
    assert.equal(stages.emittedOffers, result.offers.length);
    assert.equal(JSON.stringify(stages).includes('https://'), false);
    assert.equal(JSON.stringify(stages).includes('175'), false);
  } finally {
    globalThis.fetch = oldFetch;
    sourceReliability.reset(storeId);
  }
});
