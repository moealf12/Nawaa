// Server-only explicit key custody: no defaults, no key material in receipts.
// Old verification keys remain configured during deliberate key rotation.
// Keys must be independently provisioned outside GitHub and public payloads.
const KEY_ID=/^[a-z][a-z0-9_-]{0,31}$/;
function secret(v){
  const b=Buffer.isBuffer(v)?Buffer.from(v):typeof v==='string'?Buffer.from(v,'utf8'):null;
  if(!b||b.length<32||b.length>512)throw TypeError('invalid_private_journal_secret');
  return b;
}
export function createTrustedJournalKeyring({activeKeyId,keys}={}){
  if(typeof activeKeyId!=='string'||!KEY_ID.test(activeKeyId)||
    !keys||typeof keys!=='object'||Array.isArray(keys)||
    Object.keys(keys).length<1||Object.keys(keys).length>8)
    throw TypeError('invalid_journal_keyring');
  const m=new Map();
  for(const [id,value] of Object.entries(keys)){
    if(!KEY_ID.test(id))throw TypeError('invalid_journal_key_id');
    m.set(id,secret(value));
  }
  if(!m.has(activeKeyId))throw TypeError('missing_active_journal_key');
  return Object.freeze({
    activeKeyId,
    get:id=>m.has(id)?Buffer.from(m.get(id)):null
  });
}
// Explicit env allowlist, never accept key bytes or policy in request JSON.
// Active key comes from a named environment variable, retained keys from a
// private JSON map; absent secrets fail closed and no CI test key is a fallback.
export function trustedJournalKeyringFromEnv(env=process.env){
  const activeKeyId=env.NAWAA_TRUST_JOURNAL_ACTIVE_KEY_ID;
  const raw=env.NAWAA_TRUST_JOURNAL_PRIVATE_KEYS_JSON;
  if(!activeKeyId||!raw||raw.length>10000)
    throw TypeError('journal_server_keys_not_configured');
  let keys;
  try{keys=JSON.parse(raw)}catch{throw TypeError('invalid_journal_key_configuration')}
  return createTrustedJournalKeyring({activeKeyId,keys});
}
