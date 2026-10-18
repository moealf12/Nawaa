// Independently acquired merchant observation retained verbatim. Only predecessor is simulated.
import assert from 'node:assert/strict';
import pg from 'pg';
import {MeiliSearch} from 'meilisearch';
import {searchJarir} from '../server/providers/jarir.mjs';
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
