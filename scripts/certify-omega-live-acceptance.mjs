// Independently acquired merchant observation retained verbatim. Only predecessor is simulated.
import assert from 'node:assert/strict';
import pg from 'pg';
import {MeiliSearch} from 'meilisearch';
import {searchJarir} from '../server/providers/jarir.mjs';
import {createControlledPdpRefresh} from '../server/trusted-pdp-refresh.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';
import {createIsolatedTrustedJournalStore,CI_SIGNING_KEY} from './trusted-journal-ci-store.mjs';
import {writeFile} from 'node:fs/promises';
import {canonicalOfferPayload} from '../server/canonical-offer-identity.mjs';
import {commitCanonicalObservation,canonicalReadBoundary,initializeCanonicalIndex,publishCanonicalOutbox} from '../server/omega-canonical-index.mjs';
await initializeCanonicalIndex(); // Enforces disposable-only environment before reset.
const pool=new pg.Pool({connectionString:process.env.NAWAA_TEST_DATABASE_URL});
await pool.query('TRUNCATE nawaa_ci_omega_canonical,nawaa_ci_omega_outbox,nawaa_ci_omega_reconcile');
await pool.end();
const sdk=new MeiliSearch({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
const index=sdk.index(process.env.MEILI_INDEX);
await index.waitForTask((await index.deleteAllDocuments()).taskUid);
const acquired=await searchJarir('PS5',24,'PS5',{signal:AbortSignal.timeout(20000)});
const offers=acquired.offers.filter(o=>o.exactMatch&&canonicalOfferPayload(o)).slice(0,3);
assert.ok(offers.length,'actual Jarir acquisition required, no fixture fallback');
// v21.62 bounded actual-source attempt. A passing search observation is NOT a
// trusted same-offer certificate. Probe exactly one selected retailer record,
// without emitting a customer VERIFIED state or changing the production path.
const selectedPdp=offers.find(o=>o.providerMarket==='jarir-sa'&&o.merchant==='Jarir');
if(selectedPdp){
  // One actual authorized selected-PDP fetch. The shared controlled refresh
  // path updates source head and archives the scoped receipt atomically with
  // the appropriate journal operations; no second merchant probe.
  const db=createIsolatedTrustedJournalStore();
  try{
    await db.initialize();
    const journal=createTrustedObservationJournal({store:db.store,
      signingKey:CI_SIGNING_KEY,requireCurrentHead:true});
    const refresh=createControlledPdpRefresh({journal});
    const result=await refresh.refresh(selectedPdp,{
      signal:AbortSignal.timeout(12000),archive:true
    });
    const accepted=result.state==='RECORDED';
    if(accepted){
      assert.ok(result.receiptRef,'actual scoped verifier must issue one receipt');
      await writeFile('.trusted-journal-live.json',JSON.stringify({
        ref:result.receiptRef,offer:result.selectedOffer,
        sourceId:result.sourceId,
        documentDigest:result.selectedRecord?.documentDigest
      })+'\n');
      console.log('TRUSTED_PDP_LIVE_JOURNAL '+JSON.stringify({
        livePdpObservation:true,sourceId:result.sourceId,
        archived:true,controlledSourceHeadRecorded:true,
        additionalMerchantRequests:0,
        wholeOfferVerified:false,badgeEligible:false
      }));
    }
    console.log('TRUSTED_PDP_LIVE_PROBE '+JSON.stringify({
      observationType:'independently_fetched_same_merchant_PDP',
      sameOriginEvidenceIsNotIndependentRetailer:true,
      sourceUrl:selectedPdp.sourceUrl,sourceId:'jarir-sa',
      status:accepted?'VERIFIED':'UNVERIFIED',
      reason:accepted?null:result.reason,
      originalListingSuperseded:accepted,
      selectedPdpSku:accepted?result.selectedOffer?.sku:null,
      selectedPdpGtin:accepted?(result.selectedOffer?.gtin??null):null,
      historicalGtinState:accepted?result.historicalClaims?.gtin:null,
      historicalBarcodeState:accepted?result.historicalClaims?.barcode:null,
      gtinPredicate:accepted?result.verifiedPredicates?.gtin:null,
      sourceRecordId:accepted?result.selectedRecord?.recordId:null,
      sourceDocumentDigest:accepted?result.selectedRecord?.documentDigest:null,
      wholeOfferVerified:false,badgeEligible:false,
      revision:accepted?result.sourceRevision:null,
      sourceObservedAt:accepted?result.sourceObservedAt:null,
      durationMs:result.durationMs??null,
      note:'Diagnostic CI: controlled source refresh and journal, no customer badge, T5 or production release'
    }));
  }finally{await db.close();}
}

const evidence=[];
for(const live of offers){
 const older={...live,observedAt:new Date(Date.parse(live.observedAt)-5000).toISOString(),productPrice:live.productPrice+10};
 await commitCanonicalObservation(older);
 const current=await canonicalReadBoundary([older,{...live,dataKind:'live'}],{acceptLive:true});
 assert.equal(current.length,1);assert.equal(current[0].productPrice,live.productPrice);assert.equal(current[0].observedAt,live.observedAt);
 evidence.push({sourceUrl:live.sourceUrl,productId:live.sourceMeta?.productId,observedAt:live.observedAt,productPrice:live.productPrice,accepted:true});
}
await publishCanonicalOutbox();
console.log('REAL_OMEGA_LIVE_ACCEPTANCE '+JSON.stringify({independentAcquisition:true,simulatedPredecessor:true,evidence}));process.exit(0);
