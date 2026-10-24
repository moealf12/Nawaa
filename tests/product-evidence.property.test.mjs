import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { resolveStructuredProductNodes } from '../server/schemaorg-product-graph.mjs';
import { sameOfferIdentity } from '../server/product-identity.mjs';

// A deterministic, bounded CI property suite; failing fast-check errors report
// the seed, counterexample and replay path. No merchant network access.
// Override the default seed only to reproduce a reported failure.
const seedInput = process.env.NAWAA_FC_SEED;
const seed = seedInput === undefined ? 2146 : Number(seedInput);
if (!Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff) {
  throw new Error('NAWAA_FC_SEED must be an integer between 0 and 2147483647');
}
const checks = { seed, numRuns: 64 };

function permuteFour(source, permutationIndex) {
  const pool = [...source];
  const result = [];
  let value = permutationIndex;
  for (let remaining = 4; remaining > 0; remaining -= 1) {
    result.push(pool.splice(value % remaining, 1)[0]);
    value = Math.floor(value / remaining);
  }
  return result;
}

test('property: explicit ProductGroup references retain each own SKU, price and currency across record permutations and unrelated injections', () => {
  const page = 'https://merchant.example/p/headphones';
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 250000 }),
    fc.integer({ min: 1, max: 250000 }),
    fc.constantFrom('SAR', 'USD', 'AED'),
    fc.constantFrom('SAR', 'USD', 'AED'),
    fc.integer({ min: 1, max: 250000 }),
    fc.integer({ min: 0, max: 23 }),
    (priceACents, priceBCents, currencyA, currencyB, foreignPriceCents, permutation) => {
      const variants = [
        { key: 'standard', sku: 'SKU-STANDARD', cents: priceACents, currency: currencyA },
        { key: 'anc', sku: 'SKU-ANC', cents: priceBCents, currency: currencyB },
      ];
      const group = {
        '@type': 'ProductGroup',
        '@id': page + '#group',
        url: page,
        name: 'Headphone family',
        hasVariant: variants.map(v => ({ '@id': page + '#' + v.key })),
      };
      const products = variants.map(v => ({
        '@type': 'Product',
        '@id': page + '#' + v.key,
        name: 'Headphones ' + v.key,
        sku: v.sku,
        offers: {
          '@type': 'Offer',
          url: page + '?variant=' + v.key,
          price: v.cents / 100,
          priceCurrency: v.currency,
        },
      }));
      const unrelated = {
        '@type': 'Product',
        '@id': 'https://merchant.example/p/unrelated#product',
        url: 'https://merchant.example/p/unrelated',
        sku: 'SKU-UNRELATED',
        offers: { '@type': 'Offer', price: foreignPriceCents / 100, priceCurrency: 'USD' },
      };
      const records = permuteFour([group, ...products, unrelated], permutation);
      const resolved = resolveStructuredProductNodes(records, page);
      assert.equal(resolved.length, 1, 'off-page product must never become requested PDP');
      assert.equal(resolved[0].schemaProductGroupEvidence, true);
      const offers = Array.isArray(resolved[0].offers) ? resolved[0].offers : [resolved[0].offers];
      assert.equal(offers.length, 2);
      const bySku = new Map(offers.map(o => [o.sku, o]));
      for (const v of variants) {
        assert.equal(bySku.get(v.sku)?.price, v.cents / 100);
        assert.equal(bySku.get(v.sku)?.priceCurrency, v.currency);
        assert.equal(bySku.get(v.sku)?.url, page + '?variant=' + v.key);
      }
      assert.equal(bySku.has('SKU-UNRELATED'), false);
    },
  ), checks);
});

test('property: same listing and matching title cannot override conflicting independently supplied SKUs', () => {
  fc.assert(fc.property(
    fc.integer({ min: 100000, max: 999998 }),
    fc.constantFrom('iPhone 17 Pro 256GB', 'Apple AirPods 4', 'HP Laptop 16GB RAM'),
    fc.constantFrom('https://merchant.example/p/item', 'https://merchant.example/en-sa/p/100460151'),
    (skuNumber, title, sourceUrl) => {
      const original = {
        sourceUrl, title, brand: 'Test merchant brand',
        sku: String(skuNumber),
      };
      const conflicting = {
        ...original,
        sku: String(skuNumber + 1),
      };
      assert.equal(sameOfferIdentity(original, conflicting), false,
        'same page and title must not cancel contradictory SKU evidence');
      assert.equal(sameOfferIdentity(conflicting, original), false,
        'conflict handling must not depend on comparison direction');
    },
  ), checks);
});


test('property: conflicting Offer identifiers cannot override own ProductGroup variant ownership', () => {
  // A legitimate product has a valid price-bearing offer. A different sibling's
  // SKU/MPN in that offer is contradictory evidence, not a replacement identity.
  // The other variant remains independently sellable (recall protection).
  const page = 'https://merchant.example/p/wireless-earbuds';
  fc.assert(fc.property(
    fc.integer({ min: 100001, max: 999999 }),
    fc.constantFrom('sku', 'mpn'),
    fc.constantFrom('SAR', 'USD', 'AED'),
    (suffix, conflictingField, currency) => {
      const first = { sku: 'SKU-A-' + suffix, mpn: 'MODEL-A-' + suffix };
      const second = { sku: 'SKU-B-' + suffix, mpn: 'MODEL-B-' + suffix };
      const nodes = [
        {
          '@type': 'ProductGroup',
          '@id': page + '#group',
          url: page,
          hasVariant: [{ '@id': page + '#a' }, { '@id': page + '#b' }],
        },
        {
          '@type': 'Product',
          '@id': page + '#a',
          name: 'Wireless earbuds standard',
          ...first,
          offers: {
            '@type': 'Offer',
            url: page + '?variant=a',
            price: 129,
            priceCurrency: currency,
            [conflictingField]: second[conflictingField],
          },
        },
        {
          '@type': 'Product',
          '@id': page + '#b',
          name: 'Wireless earbuds ANC',
          ...second,
          offers: {
            '@type': 'Offer',
            url: page + '?variant=b',
            price: 199,
            priceCurrency: currency,
            sku: second.sku,
            mpn: second.mpn,
          },
        },
      ];
      const resolved = resolveStructuredProductNodes(nodes, page);
      assert.equal(resolved.length, 1);
      assert.equal(resolved[0].schemaProductGroupEvidence, true);
      const offers = resolved[0].offers;
      assert.equal(offers.length, 2);
      assert.equal(offers[0]['@type'], 'UnverifiedOffer',
        'conflicting direct Offer identifier must invalidate only the affected price');
      assert.equal(offers[0].price, undefined);
      assert.equal(offers[1].sku, second.sku);
      assert.equal(offers[1].mpn, second.mpn);
      assert.equal(offers[1].price, 199,
        'legitimately identified sibling must remain recoverable');
      assert.equal(offers[1].priceCurrency, currency);
    },
  ), checks);
});


test('v21.49 property: ProductGroup explicit variant destination must not inherit another variant Offer URL', () => {
  const page='https://merchant.example/p/wireless-earbuds';
  fc.assert(fc.property(
    fc.integer({min:100001,max:999999}),
    fc.constantFrom('SAR','USD','AED'),
    fc.constantFrom('explicit_conflict','shared_page_positive','exact_variant_positive'),
    (suffix,currency,caseKind)=>{
      const skuA='SKU-A-'+suffix,skuB='SKU-B-'+suffix;
      const ownAUrl=caseKind==='shared_page_positive'?page:page+'?variant=a';
      const offeredAUrl=caseKind==='explicit_conflict'?page+'?variant=b':page+'?variant=a';
      const nodes=[
        {'@type':'ProductGroup','@id':page+'#group',url:page,
          hasVariant:[{'@id':page+'#a'},{'@id':page+'#b'}]},
        {'@type':'Product','@id':page+'#a',
          name:'Earbuds standard',sku:skuA,url:ownAUrl,
          offers:{'@type':'Offer',sku:skuA,price:129,
            priceCurrency:currency,url:offeredAUrl}},
        {'@type':'Product','@id':page+'#b',
          name:'Earbuds ANC',sku:skuB,url:page+'?variant=b',
          offers:{'@type':'Offer',sku:skuB,price:199,
            priceCurrency:currency,url:page+'?variant=b'}},
      ];
      const resolved=resolveStructuredProductNodes(nodes,page);
      assert.equal(resolved.length,1);
      assert.equal(resolved[0].schemaProductGroupEvidence,true);
      const offers=resolved[0].offers;
      assert.equal(offers.length,2);
      if(caseKind==='explicit_conflict'){
        assert.equal(offers[0]['@type'],'UnverifiedOffer',
          'the product claiming variant=a must not publish variant=b price destination');
        assert.equal(offers[0].price,undefined);
      }else{
        assert.equal(offers[0].sku,skuA,
          'legitimate exact and shared-PDP variants must remain sellable');
        assert.equal(offers[0].price,129);
        assert.equal(offers[0].priceCurrency,currency);
        assert.equal(offers[0].url,page+'?variant=a');
      }
      assert.equal(offers[1].sku,skuB);
      assert.equal(offers[1].price,199,
        'unrelated legitimate sibling must retain its own price');
      assert.equal(offers[1].url,page+'?variant=b');
    }
  ),checks);
});
