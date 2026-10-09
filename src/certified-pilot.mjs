// Snapshot from NAWAA strict live certification run 37872544399 (15 of 39).
// It is NOT proof that these storefronts will be reachable on every request.
// Pilot visibility must never modify general customer search or certify others.
export const CERTIFIED_PILOT_RUN = "37872544399";
export const CERTIFIED_PILOT_SOURCES = Object.freeze([
  {
    "id": "aliexpress-cn",
    "name": "AliExpress",
    "countryCode": "CN",
    "sampleQueries": [
      "charger",
      "cable"
    ]
  },
  {
    "id": "ikea-sa",
    "name": "IKEA Saudi",
    "countryCode": "SA",
    "sampleQueries": [
      "chair",
      "table"
    ]
  },
  {
    "id": "asos-global",
    "name": "ASOS",
    "countryCode": "GB",
    "sampleQueries": [
      "dress",
      "shirt"
    ]
  },
  {
    "id": "amazon-sa",
    "name": "Amazon Saudi",
    "countryCode": "SA",
    "sampleQueries": [
      "iphone 17",
      "hp laptop"
    ]
  },
  {
    "id": "newegg-global",
    "name": "Newegg",
    "countryCode": "US",
    "sampleQueries": [
      "SSD",
      "laptop"
    ]
  },
  {
    "id": "bestbuy-us",
    "name": "Best Buy",
    "countryCode": "US",
    "sampleQueries": [
      "laptop",
      "headphones"
    ]
  },
  {
    "id": "namshi-sa",
    "name": "Namshi",
    "countryCode": "SA",
    "sampleQueries": [
      "shoes",
      "shirt"
    ]
  },
  {
    "id": "centrepoint-sa",
    "name": "Centrepoint",
    "countryCode": "SA",
    "sampleQueries": [
      "dress",
      "shirt"
    ]
  },
  {
    "id": "maxfashion-sa",
    "name": "Max Fashion",
    "countryCode": "SA",
    "sampleQueries": [
      "dress",
      "shirt"
    ]
  },
  {
    "id": "decathlon-sa",
    "name": "Decathlon Saudi",
    "countryCode": "SA",
    "sampleQueries": [
      "shoes",
      "backpack"
    ]
  },
  {
    "id": "niceone-sa",
    "name": "Nice One",
    "countryCode": "SA",
    "sampleQueries": [
      "perfume",
      "lipstick"
    ]
  },
  {
    "id": "goldenscent-sa",
    "name": "Golden Scent",
    "countryCode": "SA",
    "sampleQueries": [
      "perfume",
      "lipstick"
    ]
  },
  {
    "id": "mumzworld-sa",
    "name": "Mumzworld",
    "countryCode": "SA",
    "sampleQueries": [
      "stroller",
      "baby"
    ]
  },
  {
    "id": "lookfantastic-global",
    "name": "Lookfantastic",
    "countryCode": "GB",
    "sampleQueries": [
      "cleanser",
      "serum"
    ]
  },
  {
    "id": "cultbeauty-global",
    "name": "Cult Beauty",
    "countryCode": "GB",
    "sampleQueries": [
      "serum",
      "cleanser"
    ]
  }
].map(source=>Object.freeze({
  ...source,
  sampleQueries:Object.freeze(source.sampleQueries),
})));
export const certifiedPilotIds = new Set(CERTIFIED_PILOT_SOURCES.map(source=>source.id));
export function certifiedPilotSource(id) {
  return CERTIFIED_PILOT_SOURCES.find(source=>source.id===id)||null;
}
