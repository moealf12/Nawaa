export const PROFILE_STATUS = Object.freeze({ OPEN:"OPEN", COMPLETE:"COMPLETE" });
export const PROFILE_SCHEMA_VERSION = 1;

export function createExtractionProfile({ sourceId=null, sourceUrl, observedAt=new Date().toISOString() }={}) {
  if (!sourceUrl) throw new Error("sourceUrl is required");
  const u=new URL(sourceUrl);
  return {
    schemaVersion:PROFILE_SCHEMA_VERSION,
    profileVersion:1,
    status:PROFILE_STATUS.OPEN,
    sourceId,
    sourceUrl:u.toString(),
    host:u.hostname,
    platform:"unknown",
    market:null,
    currency:null,
    mechanisms:{search:null,product:null,pagination:null,variants:null,price:null,stock:null},
    requirements:{session:"unknown",cookies:"unknown",token:"unknown",javascript:"unknown",browser:"unknown",geo:"unknown"},
    endpoints:{search:[],product:[],observed:[]},
    strategies:{candidates:[],primary:null,fallback:null},
    knownQuirks:[],
    knownLimitations:[],
    evidence:[],
    verification:{},
    fieldMapping:{},
    createdAt:observedAt,
    updatedAt:observedAt,
    lastVerifiedAt:null,
  };
}

export function validateExtractionProfile(profile) {
  const errors=[];
  if (!profile || typeof profile!=="object") return {valid:false,errors:["profile must be an object"]};
  if (!profile.sourceUrl) errors.push("sourceUrl is required");
  if (![PROFILE_STATUS.OPEN,PROFILE_STATUS.COMPLETE].includes(profile.status)) errors.push("invalid status");
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion<1) errors.push("invalid profileVersion");
  return {valid:errors.length===0,errors};
}
