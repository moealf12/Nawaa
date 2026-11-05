import test from "node:test";
import assert from "node:assert/strict";
import {assertAliExpressItemRedirectIdentity} from "../server/url-resolver.mjs";

const requested="https://ar.aliexpress.com/item/1005009881103371.html?gatewayAdapt=glo2ara";
const observed="https://www.aliexpress.us/item/3256809694788619.html?gatewayAdapt=ara2usa4itemAdapt&_randl_shipto=US";

function rejectsIdentity(url, finalUrl) {
  assert.throws(
    () => assertAliExpressItemRedirectIdentity(url, finalUrl),
    error => error?.message === "ALIEXPRESS_PDP_ITEM_IDENTITY_MISMATCH" &&
      error.failureClass === "UNVERIFIED_PRODUCT_DOCUMENT",
  );
}

test("R04 AliExpress observed Arabic PDP redirect cannot inherit a different US item price",()=>{
  rejectsIdentity(requested,observed);
});

test("R04 AliExpress equivalent regional PDP host with identical item ID remains eligible",()=>{
  assert.doesNotThrow(()=>assertAliExpressItemRedirectIdentity(
    requested,
    "https://www.aliexpress.us/item/1005009881103371.html?gatewayAdapt=ara2usa4itemAdapt"
  ));
  assert.doesNotThrow(()=>assertAliExpressItemRedirectIdentity(
    requested,
    "https://www.aliexpress.com/item/1005009881103371.html"
  ));
});

test("R04 AliExpress fail closed on same-host product swap, missing product or unrelated host",()=>{
  rejectsIdentity(requested,"https://ar.aliexpress.com/item/3256809694788619.html");
  rejectsIdentity(requested,"https://www.aliexpress.us/w/wholesale-iphone-17.html");
  rejectsIdentity(requested,"https://attacker.example/item/1005009881103371.html");
  rejectsIdentity(requested,"http://www.aliexpress.com/item/1005009881103371.html");
  rejectsIdentity(requested,"https://www.aliexpress.com@attacker.example/item/1005009881103371.html");
});

test("R04 AliExpress PDP guard does not change unrelated merchant URLs or search-page semantics",()=>{
  assert.doesNotThrow(()=>assertAliExpressItemRedirectIdentity(
    "https://www.samsung.com/sa_en/search/?searchvalue=galaxy%20s25",
    "https://www.samsung.com/sa_en/aisearch/?searchvalue=galaxy%20s25"
  ));
  assert.doesNotThrow(()=>assertAliExpressItemRedirectIdentity(
    "https://www.aliexpress.com/w/wholesale-iphone-17.html",
    "https://www.aliexpress.com/w/wholesale-iphone-17.html"
  ));
});
