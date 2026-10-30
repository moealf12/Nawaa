// Test-only historical comparator. The current source is copied into a
// disposable data: module with ONLY the ASCII fast-path guard removed.
// No merchant fetch, external import, credentials or production source mutation.
import {readFileSync} from "node:fs";

export const CURRENT_SOURCE=readFileSync(new URL("../src/search-query.mjs",import.meta.url),"utf8");
const guarded=String.raw`  if (/[\u0600-\u06ff]/u.test(text)) {
    for (const [pattern, canonical] of COMPILED_ALIASES) {
      text = text.replace(pattern, "$1" + canonical);
    }
  }`;
const historical=String.raw`  for (const [pattern, canonical] of COMPILED_ALIASES) {
    text = text.replace(pattern, "$1" + canonical);
  }`;

export async function ungatedBaseline(){
  if(CURRENT_SOURCE.split(guarded).length!==2)
    throw new Error("QUERY_ALIAS_FASTPATH_SOURCE_CHANGED");
  const source=CURRENT_SOURCE.replace(guarded,historical);
  return import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
}

export const QUERIES=[
  "iPhone","iPhone 17","iPhone 17 Pro Max","iPhone 17 256GB",
  "Samsung Galaxy S25","Samsung Galaxy S25+","Samsung Galaxy S25 Ultra",
  "PS5 Slim Disc","PS5 Console with DualSense Controller","PS5 Pro",
  "Bluetooth Headphones","Bluetooth Speaker","JBL Wireless Earbuds",
  "HP Pavilion 15 Laptop 16GB RAM 512GB SSD","Apple Watch Series 11",
  "آيفون 17 256 جيجا","ايفون 17 برو ماكس","بلايستيشن ٥ ديجيتال",
  "سماعات بلوتوث","لابتوب اتش بي","سامسونج جالاكسي S25+",
  "PS5 مع يد تحكم اضافيه","آيفون iPhone 17","هاتف iPhone ١٧",
  "á â」「", "laptop-256GB/SSD + case", "Lenovo Yoga 7i 14IRL8",
  "🇸🇦 KSA iPhone 17","nothing special","1234567890",
];
