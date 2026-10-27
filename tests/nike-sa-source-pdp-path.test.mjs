import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProductLinks, routeFreeStorefronts } from '../server/providers/free-storefronts.mjs';

const query = 'nike shoes';
const searchUrl = 'https://www.nike.sa/en/search?q=nike%20shoes';
const store = routeFreeStorefronts(query, Infinity, { stable: true })
  .find(entry => entry.store.id === 'nike-sa')?.store;
assert.ok(store, 'Nike Saudi must be selected from the actual source registry');

const productLinks = [
  'https://www.nike.sa/en/pegasus-42-womens-road-running-shoes/NKIB1881-600.html',
  'https://www.nike.sa/en/mind-002-mens-pregame-shoes/NKHQ4308-300.html',
  'https://www.nike.sa/en/air-jordan-1-low-se-mens-shoes/NKII9813-600.html',
];
const nonProductLinks = [
  'https://www.nike.sa/en/collections/structure',
  'https://www.nike.sa/en/sports/football/shoes',
  'https://www.nike.sa/en/mens/shoes',
  'https://www.nike.sa/en/search?q=nike%20shoes',
  'https://www.nike.sa/en/collections/sale-shoes.html',
];
const anchor = url => '<a href="' + url + '">Nike Shoes available online</a>';

test('RED: Nike search candidate ownership excludes category and collection pages', () => {
  const html = [...nonProductLinks, ...productLinks].map(anchor).join('\n');
  const links = extractProductLinks(html, searchUrl, store, query);
  assert.deepEqual(links.map(x => x.url).sort(), productLinks.slice().sort(),
    'only independently identified Nike-style SKU product detail URLs belong in PDP resolution');
});

test('RED: categories cannot exhaust the bounded per-store PDP budget', () => {
  const html = [...nonProductLinks, productLinks[0], productLinks[1]].map(anchor).join('\n');
  const links = extractProductLinks(html, searchUrl, store, query, 2);
  assert.deepEqual(links.map(x => x.url).sort(), productLinks.slice(0, 2).sort());
});

test('positive: query/hash canonicalization retains a real Nike product record', () => {
  const url = productLinks[0] + '?color=600#size-guide';
  const links = extractProductLinks(anchor(url), searchUrl, store, query);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, productLinks[0] + '?color=600');
});

test('negative: a foreign host must not be accepted even if its product path looks valid', () => {
  const forged = 'https://unrelated.example/en/pegasus-42/NKIB1881-600.html';
  assert.deepEqual(extractProductLinks(anchor(forged), searchUrl, store, query), []);
});
