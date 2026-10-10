import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOfferMatch } from '../src/search-query.mjs';

const offer = title => ({
  title,
  sourceUrl: 'https://example.com/p/123',
  condition: 'new',
});

test('exact requested model case remains an exact match', () => {
  const result = assessOfferMatch('iPhone 15 case', offer('Case for iPhone 15'));
  assert.equal(result.exactMatch, true);
  assert.equal(result.matchConfidence, 1);
});

test('multi-device accessory lists the requested model without variant penalty', () => {
  const result = assessOfferMatch('iPhone 15 case', offer('Case for iPhone 15 / iPhone 16'));
  assert.equal(result.exactMatch, true);
  assert.equal(result.matchConfidence, 1);
});

test('incompatible model is still penalized', () => {
  const compatible = assessOfferMatch('iPhone 15 case', offer('Case for iPhone 15'));
  const incompatible = assessOfferMatch('iPhone 15 case', offer('Case for iPhone 16 only'));
  assert.equal(incompatible.exactMatch, false);
  assert.ok(incompatible.matchConfidence < compatible.matchConfidence);
});

test('Pro is not conflated with the standard device', () => {
  const result = assessOfferMatch('iPhone 15 Pro case', offer('Case for iPhone 15'));
  assert.equal(result.exactMatch, false);
});

test('phone queries never accept a protective case as the phone', () => {
  const result = assessOfferMatch('iPhone 15', offer('Case for iPhone 15'));
  assert.equal(result.exactMatch, false);
  assert.ok(result.matchConfidence < 0.65);
});

test('accessory queries never accept a smartphone as an exact case', () => {
  const result = assessOfferMatch('iPhone 15 case', offer('iPhone 15 smartphone'));
  assert.equal(result.exactMatch, false);
});
