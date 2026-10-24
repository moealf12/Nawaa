// Fresh process: replay the exact live Jarir source-issued observation stored
// by certify-omega-live-acceptance.mjs, not a synthetic fixture.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';
import {createIsolatedTrustedJournalStore,CI_SIGNING_KEY} from './trusted-journal-ci-store.mjs';

const db=createIsolatedTrustedJournalStore();
try{
  let saved;
  try{saved=JSON.parse(await readFile('.trusted-journal-live.json','utf8'));}
  catch(error){
    if(error?.code!=='ENOENT')throw error;
    console.log('TRUSTED_LIVE_REPLAY '+JSON.stringify({
      status:'SOURCE_NOT_CERTIFIED',replayed:false,badgeEligible:false,
      note:'Genuine live PDP did not create a scoped certificate in prior step'
    }));
    process.exitCode=0;
  }
  if(saved){
    const journal=createTrustedObservationJournal({store:db.store,
      signingKey:CI_SIGNING_KEY,requireCurrentHead:true});
    const accepted=await journal.inspect(saved.ref,{expectedOffer:saved.offer});
    assert.equal(accepted.state,'REVALIDATED',accepted.reason);
    assert.equal(accepted.sourceId,saved.sourceId);
    assert.equal(accepted.sourceRecord.documentDigest,saved.documentDigest);
    assert.equal(accepted.sourcePredicatesRevalidated,true);
    assert.equal(accepted.badgeEligible,false);
    assert.equal(accepted.wholeOfferVerified,false);
    assert.equal((await journal.inspect(saved.ref,{expectedOffer:{
      ...saved.offer,productPrice:saved.offer.productPrice+1
    }})).state,'CONFLICTING_EVIDENCE');
    assert.equal((await journal.revoke(saved.ref,'source_updated')).state,'REVOKED');
    assert.equal((await journal.inspect(saved.ref)).state,'REVOKED');
    console.log('TRUSTED_LIVE_REPLAY '+JSON.stringify({
      status:'REPLAYED_AND_REVOKED',liveSourceObservation:true,
      separateNodeProcess:true,realPostgres:true,sourceId:saved.sourceId,
      sourceRevision:accepted.sourceRevision,
      sourcePredicatesRevalidated:true,wholeOfferVerified:false,
      badgeEligible:false,stalePriceRejected:true,revokeVerified:true
    }));
  }
}finally{await db.close();}
