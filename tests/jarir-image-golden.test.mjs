import test from 'node:test';
import assert from 'node:assert/strict';
import {GOLDEN_CASES,GOLDEN_META} from './fixtures/jarir-image-golden.mjs';
import {parseJarirSearchHtml} from '../server/providers/jarir.mjs';
import {assessOfferMatch} from '../src/search-query.mjs';

// Ground truth is authored in fixture independently of Jarir's extraction code.
// This exercises only saved synthetic HTML; it does not certify merchant uptime,
// actual current price, FX recency or remote product-image correctness.
const card=entry=>`<div class="product-tile__item--spacer" data-cnstrc-item-id="${entry.productId}"
  data-cnstrc-item-name="${entry.title}" data-cnstrc-item-price="${entry.price}">
  <a href="https://www.jarir.com/sa-en/golden-${entry.productId}.html" data-product-id="${entry.productId}">View</a>
  ${entry.images.map(image=>`<img src="${image.src}" alt="${image.alt}">`).join('')}
</div>`;

test('Jarir hand-labelled Golden Dataset retains valid products without associating foreign images',()=>{
  assert.equal(GOLDEN_META.origin,'synthetic-hand-labelled');
  assert.equal(GOLDEN_META.capturedAt,null);
  const html=GOLDEN_CASES.map(card).join('\n');
  const outputs=parseJarirSearchHtml(html,100);
  const accepted=GOLDEN_CASES.filter(c=>c.expected.accepted);
  const excluded=GOLDEN_CASES.filter(c=>!c.expected.accepted);
  const byId=new Map(outputs.map(o=>[o.sourceMeta.productId,o]));
  assert.equal(outputs.length,accepted.length,'all labelled eligible cards survive, invalid price is excluded');
  for(const row of excluded)assert.equal(byId.has(row.productId),false,row.id);

  let retained=0,priceCorrect=0,variantCorrect=0,variantEvaluated=0;
  let associated=0,correctAssociated=0,wrongSuppressed=0,suppressionCases=0;
  for(const entry of accepted){
    const actual=byId.get(entry.productId);
    assert.ok(actual,'eligible candidate must survive: '+entry.id);
    retained++;
    assert.equal(actual.title,entry.title,entry.id+' title/identity');
    assert.match(actual.sourceUrl,new RegExp('golden-'+entry.productId+'\\.html$'));
    assert.equal(actual.productPrice,entry.expected.price,entry.id+' price');
    assert.equal(actual.currency,entry.expected.currency,entry.id+' currency');
    priceCorrect++;
    if(entry.kind==='main'){
      variantEvaluated++;
      assert.equal(actual.specs.storage,entry.expected.storage,entry.id+' storage');
      assert.equal(actual.specs.color,entry.expected.color,entry.id+' variant color');
      variantCorrect++;
    }
    if(entry.expected.image){
      associated++;
      assert.equal(actual.image,entry.expected.image,entry.id+' verified fixture image association');
      correctAssociated++;
    }else{
      if(entry.images.length){suppressionCases++;wrongSuppressed++;}
      assert.equal(actual.image,null,entry.id+' lacks a matching product image');
    }
    assert.equal(actual.originalCurrency,'SAR');
    assert.equal(actual.originalProductPrice,entry.expected.price);
    // Parser timestamps are local parsing observations, not independently
    // captured merchant-freshness proof; freshness certification remains N/A.
    assert.ok(Number.isFinite(Date.parse(actual.observedAt)));
  }
  const accessory=byId.get('gf103');
  assert.equal(assessOfferMatch('iPhone 17 256GB',accessory).exactMatch,false,
    'matching a compatible phone name does not make the case an exact phone');
  // Explicit fixture denominators; no zero-denominator claims.
  const metrics={
    invalidFreshAdmissions:[outputs.length-accepted.length,excluded.length],
    eligibleRetention:[retained,accepted.length],
    priceCurrencyCorrectness:[priceCorrect,accepted.length],
    variantCorrectness:[variantCorrect,variantEvaluated],
    imageCorrectness:[correctAssociated,associated],
    rejectedMismatchedImageCount:[wrongSuppressed,suppressionCases],
  };
  assert.deepEqual(metrics,{
    invalidFreshAdmissions:[0,1],
    eligibleRetention:[6,6],
    priceCurrencyCorrectness:[6,6],
    variantCorrectness:[5,5],
    imageCorrectness:[3,3],
    rejectedMismatchedImageCount:[2,2],
  });
});
