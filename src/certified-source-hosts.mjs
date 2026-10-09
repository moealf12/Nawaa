// Fail-closed list of merchant domains for the 15-source PILOT only.
// Changes must follow the independent source-certification process.
// Domain suffix matching in the attestor requires a '.' boundary.
export const CERTIFIED_SOURCE_HOSTS=Object.freeze({
 "aliexpress-cn":Object.freeze(["aliexpress.com"]),
 "ikea-sa":Object.freeze(["ikea.com"]),
 "asos-global":Object.freeze(["asos.com"]),
 "amazon-sa":Object.freeze(["amazon.sa"]),
 "newegg-global":Object.freeze(["newegg.com"]),
 "bestbuy-us":Object.freeze(["bestbuy.com"]),
 "namshi-sa":Object.freeze(["namshi.com"]),
 "centrepoint-sa":Object.freeze(["centrepointstores.com"]),
 "maxfashion-sa":Object.freeze(["maxfashion.com"]),
 "decathlon-sa":Object.freeze(["decathlon.com.sa"]),
 "niceone-sa":Object.freeze(["niceonesa.com"]),
 "goldenscent-sa":Object.freeze(["goldenscent.com"]),
 "mumzworld-sa":Object.freeze(["mumzworld.com"]),
 "lookfantastic-global":Object.freeze(["lookfantastic.com"]),
 "cultbeauty-global":Object.freeze(["cultbeauty.com"]),
});
