import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedSourceSubjectKey,SOURCE_SUBJECT_KEY_POLICY} from '../server/trusted-source-subject-key.mjs';
const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
test('v21.77 source key coalesces only known tracking differences, not selected variants',()=>{
  const key=u=>trustedSourceSubjectKey('jarir-sa','668751',u);
  const base=key(URL);
  assert.match(base,/^[a-f0-9]{64}$/);
  assert.equal(key(URL+'?utm_source=search&gclid=abc'),base);
  assert.equal(key(URL+'?utm_source=pdp&fbclid=def'),base);
  assert.equal(key(URL+'#details'),base);
  assert.equal(key(URL.replace('www.jarir.com','jarir.com')),base);
  assert.notEqual(key(URL+'?sku=668752'),base);
  assert.notEqual(key(URL+'?variant=black'),key(URL+'?variant=white'));
  assert.notEqual(key(URL+'?option=A&option=B'),key(URL+'?option=B&option=A'),
    'ordered duplicate selectors cannot collapse into one source subject');
  assert.notEqual(key(URL+'?custom=red'),key(URL+'?custom=blue'));
  assert.equal(SOURCE_SUBJECT_KEY_POLICY,'selected-merchant-offer-v2');
});
test('v21.77 source identity fails closed on malformed or non-merchant destinations',()=>{
  for(const input of [null,'', 'http://www.jarir.com/x',
    'https://evil.example/x','https://user:secret@www.jarir.com/x',
    'https://www.jarir.com:8443/x','javascript:alert(1)',
    'https://jarir.com.evil.example/x']){
    assert.equal(trustedSourceSubjectKey('jarir-sa','668751',input),null,String(input));
  }
  assert.equal(trustedSourceSubjectKey('jarir-sa','',URL),null);
  assert.equal(trustedSourceSubjectKey('extra-sa','668751',URL),null);
});
