// HAND-LABELLED SYNTHETIC DATASET; NOT A LIVE JARIR CAPTURE.
// Origin: independently written product-tile HTML scenarios inspired by
// existing tests/providers.test.mjs Jarir fixture shape.
// Authored: 2026-10-14 UTC; merchant capture time: NONE.
// Ground-truth labels below are human-authored fixture intent, not parser output.
// Source under evaluation: existing Jarir Saudi HTML fallback, no source activation.
export const GOLDEN_META=Object.freeze({
 sourceId:'jarir-sa',provider:'jarir-direct',origin:'synthetic-hand-labelled',
 authoredAt:'2026-10-14',capturedAt:null,liveVerified:false,
 query:'iPhone 17 256GB',
});
export const GOLDEN_CASES=[
 {id:'phone-256-lavender',kind:'main',productId:'gf101',
  title:'Apple iPhone 17, 256 GB, Lavender, 5G, Apple A19',price:'4299',
  images:[{src:'https://images.example.test/sale-banner.jpg',alt:'October Sale'},
          {src:'https://images.example.test/iphone-lavender.jpg',alt:'Apple iPhone 17, 256 GB, Lavender, 5G, Apple A19'}],
  expected:{accepted:true,price:4299,currency:'SAR',storage:'256 GB',color:'Lavender',image:'https://images.example.test/iphone-lavender.jpg'}},
 {id:'phone-512-black',kind:'main',productId:'gf102',
  title:'Apple iPhone 17, 512 GB, Black, 5G, Apple A19',price:'4899',
  images:[{src:'https://images.example.test/iphone-black.jpg',alt:'Apple iPhone 17, 512 GB, Black, 5G, Apple A19'}],
  expected:{accepted:true,price:4899,currency:'SAR',storage:'512 GB',color:'Black',image:'https://images.example.test/iphone-black.jpg'}},
 {id:'case-clear',kind:'accessory',productId:'gf103',
  title:'Apple iPhone 17 Protective Case Cover',price:'119',
  images:[{src:'https://images.example.test/case-clear.jpg',alt:'Apple iPhone 17 Protective Case Cover'}],
  expected:{accepted:true,price:119,currency:'SAR',storage:null,color:null,image:'https://images.example.test/case-clear.jpg'}},
 {id:'phone-256-blue-foreign-image',kind:'main',productId:'gf104',
  title:'Apple iPhone 17, 256 GB, Blue, 5G, Apple A19',price:'4399',
  images:[{src:'https://images.example.test/galaxy-s26.jpg',alt:'Samsung Galaxy S26'}],
  expected:{accepted:true,price:4399,currency:'SAR',storage:'256 GB',color:'Blue',image:null}},
 {id:'phone-256-white-promo',kind:'main',productId:'gf105',
  title:'Apple iPhone 17, 256 GB, White, 5G, Apple A19',price:'4399',
  images:[{src:'https://images.example.test/promo.jpg',alt:'Storewide Promotion'}],
  expected:{accepted:true,price:4399,currency:'SAR',storage:'256 GB',color:'White',image:null}},
 {id:'phone-256-green-no-image',kind:'main',productId:'gf106',
  title:'Apple iPhone 17, 256 GB, Green, 5G, Apple A19',price:'4299',
  images:[],
  expected:{accepted:true,price:4299,currency:'SAR',storage:'256 GB',color:'Green',image:null}},
 {id:'invalid-unpriced-card',kind:'main',productId:'gf107',
  title:'Apple iPhone 17, 256 GB, Red, 5G, Apple A19',price:'invalid',
  images:[{src:'https://images.example.test/iphone-red.jpg',alt:'Apple iPhone 17, 256 GB, Red, 5G, Apple A19'}],
  expected:{accepted:false}},
];
