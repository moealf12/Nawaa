import { validateExtractionProfile } from "./profile-schema.mjs";

const memoryStore=new Map();

export async function saveExtractionProfile(profile,{store=memoryStore}={}) {
  const validation=validateExtractionProfile(profile);
  if (!validation.valid) throw new Error("Invalid extraction profile: "+validation.errors.join(", "));
  const key=profile.sourceId || profile.host || new URL(profile.sourceUrl).hostname;
  store.set(key,structuredClone(profile));
  return structuredClone(profile);
}

export async function loadExtractionProfile(key,{store=memoryStore}={}) {
  const value=store.get(key);
  return value ? structuredClone(value) : null;
}

export function createProfileStore(){ return new Map(); }
