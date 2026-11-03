// R04 P0: replay the *same acquired wave* without refetching merchants.
// Separate from depth cursors, which acquire NEW stores/pages. No snapshot
// is persisted or presented as durable inventory evidence.
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";

const material=process.env.NAWAA_CURSOR_SECRET || process.env.NAWAA_INGEST_TOKEN || randomBytes(32);
const secret=createHash("sha256").update(material).update(":nawaa-wave-v1").digest();
const fingerprint=query=>createHash("sha256").update(String(query)).digest("base64url").slice(0,22);
const mac=body=>createHmac("sha256",secret).update(body).digest("base64url");
export const SEARCH_WAVE_TTL_MS=120_000;

function encode(query,id,offset,time){
  const body=Buffer.from(JSON.stringify({v:2,k:"wave",q:fingerprint(query),id,o:offset,t:time})).toString("base64url");
  return body+"."+mac(body);
}
function decode(query,token,now,ttl){
  const value=String(token||"");
  if(value.length<30||value.length>512)throw new Error("invalid_wave_cursor");
  const [body,sign,extra]=value.split(".");
  if(!body||!sign||extra||!/^[A-Za-z0-9_-]+$/.test(body)||!/^[A-Za-z0-9_-]+$/.test(sign))
    throw new Error("invalid_wave_cursor");
  const expected=Buffer.from(mac(body));
  const supplied=Buffer.from(sign);
  if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))
    throw new Error("invalid_wave_cursor");
  let payload;
  try{payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));}
  catch{throw new Error("invalid_wave_cursor");}
  if(payload?.v!==2||payload.k!=="wave"||payload.q!==fingerprint(query)||
      typeof payload.id!=="string"||!/^[A-Za-z0-9_-]{22}$/.test(payload.id)||
      !Number.isSafeInteger(payload.o)||payload.o<=0||
      !Number.isSafeInteger(payload.t)||payload.t>now+60_000)
    throw new Error("invalid_wave_cursor");
  if(now-payload.t>=ttl)throw new Error("expired_wave_cursor");
  return payload;
}

export function createSearchWavePages({
  now=Date.now,ttlMs=SEARCH_WAVE_TTL_MS,maxEntries=12,
  maxBytes=32*1024*1024,maxSnapshotBytes=6*1024*1024,
}={}){
  if(typeof now!=="function"||!Number.isSafeInteger(ttlMs)||ttlMs<=0||
    !Number.isSafeInteger(maxEntries)||maxEntries<0||
    !Number.isSafeInteger(maxBytes)||maxBytes<0||
    !Number.isSafeInteger(maxSnapshotBytes)||maxSnapshotBytes<0)
    throw new TypeError("invalid_wave_page_config");
  const snapshots=new Map();
  let usedBytes=0;
  const remove=id=>{
    const item=snapshots.get(id);
    if(item){usedBytes-=item.bytes;snapshots.delete(id);}
  };
  const purge=()=>{
    for(const [id,item] of snapshots){
      if(now()-item.createdAt>=ttlMs)remove(id);
    }
  };
  function remember(query,depth,offers,pageSize,result){
    if(!Array.isArray(offers)||!Number.isSafeInteger(pageSize)||pageSize<=0||
      offers.length<=pageSize)return {cursor:null,unavailable:false};
    if(maxEntries===0||maxBytes===0||maxSnapshotBytes===0)
      return {cursor:null,unavailable:true};
    purge();
    try{
      const meta=JSON.stringify({...result,offers:[]});
      const serialized=JSON.stringify(offers);
      // Conservative 2x factor covers JavaScript UTF-16 representation.
      const bytes=2*(Buffer.byteLength(meta)+Buffer.byteLength(serialized));
      if(bytes>maxSnapshotBytes||bytes>maxBytes)
        return {cursor:null,unavailable:true};
      while(snapshots.size>=maxEntries||usedBytes+bytes>maxBytes)
        remove(snapshots.keys().next().value);
      const id=randomBytes(16).toString("base64url");
      const createdAt=now();
      snapshots.set(id,{query,depth,pageSize,createdAt,meta,serialized,
        count:offers.length,bytes});
      usedBytes+=bytes;
      return {cursor:encode(query,id,pageSize,createdAt),unavailable:false};
    }catch{
      return {cursor:null,unavailable:true};
    }
  }
  function page(query,token){
    purge();
    const payload=decode(query,token,now(),ttlMs);
    const entry=snapshots.get(payload.id);
    if(!entry||entry.query!==query)throw new Error("wave_snapshot_unavailable");
    if(payload.t!==entry.createdAt||payload.o%entry.pageSize!==0||
       payload.o>=entry.count)throw new Error("invalid_wave_cursor");
    const offers=JSON.parse(entry.serialized).slice(payload.o,payload.o+entry.pageSize);
    const meta=JSON.parse(entry.meta);
    const end=payload.o+offers.length;
    const more=end<entry.count;
    return {...meta,offers,
      overflowCursor:more?encode(query,payload.id,end,entry.createdAt):null,
      coverage:{...meta.coverage,availableOffers:entry.count,
        returnedOffers:offers.length,
        returnedMerchants:new Set(offers.map(o=>JSON.stringify([
          o?.provider||"",o?.merchant||o?.providerMarket||""
        ]))).size,
        truncated:more||meta.coverage?.resultLimitReached===true,
        wavePage:{offset:payload.o,returned:offers.length,
          total:entry.count,remaining:entry.count-end},
        overflowUnavailable:false},
      acquisitionDepth:entry.depth};
  }
  return {remember,page,clear:()=>{snapshots.clear();usedBytes=0;},
    stats:()=>({entries:snapshots.size,bytes:usedBytes})};
}
