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
