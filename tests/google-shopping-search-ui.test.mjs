import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {googleShoppingDiscoveryDescriptor} from "../src/google-shopping-discovery.mjs";

test("Google Shopping: dedicated UI is present and hidden by default",async()=>{
  const html=await readFile(new URL("../search.html",import.meta.url),"utf8");
  assert.match(html,/<section class="google-shopping-discovery" id="googleShoppingDiscovery"[^>]* hidden>/);
  assert.match(html,/<a class="google-shopping-discovery__link" id="googleShoppingDiscoverLink"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*referrerpolicy="no-referrer"/);
  assert.match(html,/google-shopping-discovery\[hidden\]\s*\{\s*display:none\s*\}/);
  // The URL is dynamically assigned only after user enters a valid query.
  assert.doesNotMatch(html,/<a[^>]*id="googleShoppingDiscoverLink"[^>]*href=/);
});

test("Google Shopping: bound to actual search input and query lifecycle, never automatic network fetch",async()=>{
  const js=await readFile(new URL("../src/search-page.mjs",import.meta.url),"utf8");
  assert.match(js,/import\s*\{googleShoppingDiscoveryDescriptor\}/);
  assert.match(js,/function updateGoogleShoppingDiscovery\(rawQuery\)/);
  assert.match(js,/els\.input\.addEventListener\("input",\s*\(\)\s*=>\s*updateGoogleShoppingDiscovery\(els\.input\.value\)\)/);
  assert.match(js,/async function runSearch\(rawQuery\)[\s\S]*?updateGoogleShoppingDiscovery\(query\)/);
  assert.match(js,/els\.googleShoppingLink\.href\s*=\s*external\.href/);
  assert.match(js,/els\.googleShoppingLink\.removeAttribute\?\.\("href"\)/);
  assert.doesNotMatch(js,/fetch\s*\(\s*external\.href\s*\)/);
});

test("Google Shopping: no registry/provider/source coupling or migration of price observations",async()=>{
  const registry=await readFile(new URL("../src/source-registry.mjs",import.meta.url),"utf8");
  const config=await readFile(new URL("../server/source-config.mjs",import.meta.url),"utf8");
  const server=await readFile(new URL("../server/server.mjs",import.meta.url),"utf8");
  for(const text of [registry,config])
    assert.doesNotMatch(text,/google-shopping|googleShoppingDiscovery/);
  const publicModuleEntry='["/src/google-shopping-discovery.mjs", "src/google-shopping-discovery.mjs"],';
  assert.ok(server.includes(publicModuleEntry),
    "Render may serve the public client module, but never treat Shopping as a provider");
  assert.ok(server.includes('["/src/google-shopping-cards.mjs", "src/google-shopping-cards.mjs"],'),
    "The visual card renderer must be served as a public module by Render");
  assert.ok(server.includes('"/api/discovery/google-shopping"'),
    "Dedicated provider-backed discovery endpoint must be present");
  assert.ok(server.includes('createGoogleShoppingResultsClient()'),
    "Google Shopping discovery must be a separate disabled-by-default budgeted client");
  assert.doesNotMatch(config,/google-shopping|googleShoppingDiscovery/,
    "Google Shopping is never in configuredProviders");

  const d=googleShoppingDiscoveryDescriptor("PS5 Pro");
  assert.equal(d.returnsOffers,false);
  assert.equal(d.comparableWithNawaa,false);
  assert.equal(d.verifiedPrices,0);
});
