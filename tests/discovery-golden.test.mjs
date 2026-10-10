import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSearchQuery} from '../src/search-query.mjs';

const data=JSON.parse(readFileSync(new URL('../benchmarks/discovery-golden-v1.json', import.meta.url),'utf8'));
test('NAWAA 3.0 golden dataset has unique cases, valid groups and explicit intent',()=>{
 assert.equal(data.schemaVersion,1);
 assert.ok(data.cases.length>=16);
 const ids=new Set();
 for(const item of data.cases){
  assert.ok(item.id && item.query && item.expected?.intent);
  assert.ok(!ids.has(item.id),'duplicate golden case: '+item.id);
  ids.add(item.id);
  assert.ok(Array.isArray(item.expected.groupOrder) && item.expected.groupOrder.length>=2);
  assert.equal(new Set(item.expected.groupOrder).size,item.expected.groupOrder.length);
  assert.equal(item.status,'target_not_yet_measured');
 }
});
test('current query normalization baseline is captured separately from future discovery goals',()=>{
 for(const item of data.cases){
  const actual=normalizeSearchQuery(item.query);
  assert.ok(actual.length>0,'normalized query empty: '+item.id);
  // Do not assert target grouping or ranking yet: Phase I records the desired behavior,
  // not the falsely claimed performance of today's live search engine.
 }
});
test('explicit generations and accessory intent are distinguished in golden targets',()=>{
 const byId=Object.fromEntries(data.cases.map(c=>[c.id,c]));
 assert.equal(byId['iphone-exact-generation'].expected.intent,'exact');
 assert.equal(byId['iphone-accessory'].expected.intent,'accessory');
 assert.equal(byId['iphone-family-en'].expected.groupOrder[0],'phone_primary');
 assert.ok(byId['iphone-family-en'].expected.groupOrder.indexOf('accessory')>0);
 assert.ok(byId['hp-category'].expected.groupOrder.indexOf('accessory')>0);
});
