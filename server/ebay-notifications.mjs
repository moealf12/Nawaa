import { createHash, createPublicKey, verify } from 'node:crypto';
import { getEbayApplicationToken } from './providers/ebay.mjs';

// Public signing keys only; never store deletion payloads or account identifiers.
export function createEbayPublicKeyLoader({fetchImpl = fetch, getToken = getEbayApplicationToken, now = Date.now} = {}) {
  const keys = new Map();
  return async (kid) => {
    const cached = keys.get(kid);
    if (cached && now() < cached.expiresAt) return cached.key;
    const token = await getToken();
    const response = await fetchImpl(`https://api.ebay.com/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, {
      headers: {authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('eBay signing key unavailable');
    const data = await response.json();
    const encodedKey = String(data.key || '').replace('-----BEGIN PUBLIC KEY-----','').replace('-----END PUBLIC KEY-----','').replace(/\s/g,'');
    if (!/^[A-Za-z0-9+/=]+$/.test(encodedKey)) throw new Error('Invalid signing key');
    const pem = `-----BEGIN PUBLIC KEY-----\n${encodedKey.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ec') throw new Error('Unexpected signing key');
    if (keys.size >= 32) keys.delete(keys.keys().next().value);
    keys.set(kid, {key, expiresAt: now() + 3600000});
    return key;
  };
}

export function createEbayDeletionHandler({token, endpoint, getPublicKey = createEbayPublicKeyLoader(), onDelete}) {
  const ready = /^[a-zA-Z0-9_-]{32,80}$/.test(token || '') && /^https:\/\//.test(endpoint || '');
  const reply = (res, status, data) => {
    res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'});
    res.end(data ? JSON.stringify(data) : '');
  };
  return async (req, res, url) => {
    if (!ready) return reply(res,503,{error:'Notification endpoint is not configured'});
    if (req.method === 'GET') {
      const challenge = url.searchParams.get('challenge_code');
      if (!challenge || challenge.length > 1024) return reply(res,400,{error:'Missing or invalid challenge'});
      return reply(res,200,{challengeResponse:createHash('sha256').update(challenge + token + endpoint).digest('hex')});
    }
    if (req.method !== 'POST') return reply(res,405,{error:'Method not allowed'});
    let signature;
    try {
      const header = req.headers['x-ebay-signature'];
      if (typeof header !== 'string' || header.length > 4096) throw Error();
      signature = JSON.parse(Buffer.from(header,'base64').toString('utf8'));
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(signature.kid || '') || typeof signature.signature !== 'string' || !signature.signature.length || signature.signature.length > 2048) throw Error();
    } catch { return reply(res,412,{error:'Invalid signature'}); }
    let payload;
    try {
      const chunks=[];let size=0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) return reply(res,413,{error:'Payload too large'});
        chunks.push(chunk);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return reply(res,400,{error:'Invalid payload'}); }
    let key;
    try { key = await getPublicKey(signature.kid); }
    catch { return reply(res,503,{error:'Signing key unavailable; retry later'}); }
    let valid = false;
    try {
      // eBay's Node SDK signs JSON.stringify(message) using ECC / SHA-1.
      valid = key.asymmetricKeyType === 'ec' && verify('sha1',Buffer.from(JSON.stringify(payload)),key,Buffer.from(signature.signature,'base64'));
    } catch {}
    if (!valid) return reply(res,412,{error:'Invalid signature'});
    const data = payload?.notification?.data;
    if (payload?.metadata?.topic !== 'MARKETPLACE_ACCOUNT_DELETION' || !payload?.notification?.notificationId || !data || ![data.username,data.userId,data.eiasToken].some(value=>typeof value === 'string' && value.length)) return reply(res,400,{error:'Invalid deletion notification'});
    try { await onDelete(); }
    catch { return reply(res,503,{error:'Deletion processing failed; retry later'}); }
    return reply(res,204);
  };
}
