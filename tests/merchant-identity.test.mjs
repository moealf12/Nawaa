import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantName} from '../server/url-resolver.mjs';

test('merchant names represent retailers, not generic application subdomains',()=>{
  const cases=[
    ['https://app.virginmegastore.ae/en/p/12345','Virgin Megastore'],
    ['https://www.virginmegastore.sa/en/product','Virgin Megastore'],
    ['https://shop.apple.com/sa/product','Apple'],
    ['https://mobile.jarir.com/sa-en/p/12345','Jarir'],
    ['https://www.extra.com/sa-en/product','eXtra'],
    ['https://app.com/legitimate-brand','App'],
  ];
  for(const [url,expected] of cases)assert.equal(merchantName(url),expected,url);
});
