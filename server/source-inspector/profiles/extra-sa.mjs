export const EXTRA_SA_PROFILE=Object.freeze({
 schemaVersion:1,profileVersion:1,status:"COMPLETE",sourceId:"extra-sa",sourceUrl:"https://www.extra.com/en-sa",host:"www.extra.com",platform:"magento",market:"KSA",currency:"SAR",
 mechanisms:{search:"unbxd-json",product:"embedded-state",pagination:"offset",variants:"sku",price:"numeric-product-price",stock:"city-stock-array"},
 requirements:{session:"not-required",cookies:"not-required",token:"public-storefront-config",javascript:"not-required",browser:"not-required",geo:"market-path"},
 endpoints:{search:["https://search.unbxd.io/{apiKey}/{siteKey}/search"],product:["https://www.extra.com/en-sa/**/p/{sku}"],observed:["https://www.extra.com/en-sa/search/autocompleteSecure"]},
 strategies:{primary:{id:"unbxd-json",score:88.8},fallback:{id:"embedded-product-state",score:80}},
 knownQuirks:["UNBXD can return promotional records without title/price/productUrl; these are content records, not commerce offers.","Store availability can be an array of Saudi city stock states."],
 knownLimitations:["Search provider total may include non-product promotional records; pagination advances by raw records while offer output retains commerce products only."],
 fieldMapping:{sourceProductId:"uniqueId",title:"title",model:"model",price:"price",originalPrice:"originalPrice",productUrl:"productUrl"},evidence:[],verification:{},createdAt:null,updatedAt:null,lastVerifiedAt:null
});
