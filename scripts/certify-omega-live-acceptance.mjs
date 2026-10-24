// Independently acquired merchant observation retained verbatim. Only predecessor is simulated.
import assert from 'node:assert/strict';
import pg from 'pg';
import {MeiliSearch} from 'meilisearch';
import {searchJarir} from '../server/providers/jarir.mjs';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
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
  const verifier=createPdpObservationSession();
  const started=Date.now();
  const claim=await verifier.verifySelectedRevision(selectedPdp,{signal:AbortSignal.timeout(12000)});
  const accepted=claim.state==='VERIFIED'&&await verifier.accepts(claim);
  const evidence=accepted?verifier.evidence(claim.observationRef):null;
  // Separately archive the ACTUAL merchant-derived scoped decision in an
  // isolated PostgreSQL test table. The next CI step must revalidate it from
  // a different Node process. No source HTML is invented or overwritten.
  if(accepted){
    const db=createIsolatedTrustedJournalStore();
    try{
      await db.initialize();
      const journal=createTrustedObservationJournal({store:db.store,
        signingKey:CI_SIGNING_KEY,requireCurrentHead:true});
      const receipt=await journal.archive(claim);
      assert.equal(receipt.state,'ARCHIVED',receipt.reason);
      const recorded=await journal.recordFreshSource(claim);
      assert.equal(recorded.state,'RECORDED',recorded.reason);
      await writeFile('.trusted-journal-live.json',JSON.stringify({
        ref:receipt.receiptRef,offer:claim.offer,sourceId:evidence.sourceId,
        documentDigest:evidence.sourceRecord.documentDigest
      })+'\n');
      console.log('TRUSTED_PDP_LIVE_JOURNAL '+JSON.stringify({
        livePdpObservation:true,sourceId:evidence.sourceId,
        archived:true,controlledSourceHeadRecorded:true,
        additionalMerchantRequests:0,
        wholeOfferVerified:false,badgeEligible:false
      }));
    }finally{await db.close();}
  }
  console.log('TRUSTED_PDP_LIVE_PROBE '+JSON.stringify({
    observationType:'independently_fetched_same_merchant_PDP',
    sameOriginEvidenceIsNotIndependentRetailer:true,
    sourceUrl:selectedPdp.sourceUrl,sourceId:'jarir-sa',
    status:accepted?'VERIFIED':'UNVERIFIED',
    reason:accepted?null:claim.reason,
    originalListingSuperseded:accepted?claim.originalListingSuperseded:false,
    selectedPdpSku:accepted?claim.offer.sku:null,
    selectedPdpGtin:accepted?(evidence?.gtin??null):null,
    historicalGtinState:accepted?claim.historicalClaims?.gtin:null,
    historicalBarcodeState:accepted?claim.historicalClaims?.barcode:null,
    gtinPredicate:accepted?claim.decision.predicates.gtin:null,
    sourceRecordId:accepted?evidence?.sourceRecord?.recordId:null,
    sourceDocumentDigest:accepted?evidence?.sourceRecord?.documentDigest:null,
    wholeOfferVerified:accepted?claim.wholeOfferVerified:false,
    badgeEligible:accepted?claim.badgeEligible:false,
    revision:accepted?evidence?.revision:null,
    sourceObservedAt:accepted?evidence?.observedAt:null,
    durationMs:Date.now()-started,
    note:'Diagnostic CI only: no customer badge, no T5, no production release'
  }));
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
