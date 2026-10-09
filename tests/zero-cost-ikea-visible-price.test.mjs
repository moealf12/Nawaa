import test from "node:test";
import assert from "node:assert/strict";
import {visibleIkeaPriceFromHtml} from "../scripts/probe-ikea-price-dom.mjs";
const title="POÄNG Armchair - birch veneer/Knisa light beige";
function page(inner){return "<html><body><main><div class='pipcom-pip-price-module'>"+inner+"</div></main></body></html>";}
test("accepts unique matching SAR amount in product purchase module",()=>{
 const r=visibleIkeaPriceFromHtml(page("POÄNG Armchair, birch veneer/Knisa light beige ﷼479 ﷼ 479 Price incl. VAT"),title);
 assert.equal(r.status,"matched_module");
 assert.equal(r.price,479);
 assert.equal(r.copies,2);
});
test("supports fractional prices",()=>{
 const r=visibleIkeaPriceFromHtml(page("POÄNG Armchair ﷼24.95 ﷼ 24.95"),title);
 assert.equal(r.price,24.95);
});
test("fails closed on multiple distinct SAR amounts in same module",()=>{
 assert.equal(visibleIkeaPriceFromHtml(page("POÄNG Armchair ﷼479 Old price ﷼399"),title).status,"conflict");
});
test("rejects a different product module",()=>{
 assert.equal(visibleIkeaPriceFromHtml(page("MICKE Desk ﷼479"),title).status,"unavailable");
});
test("ignores script-only and decorative prices",()=>{
 const html="<script>const fake='POÄNG Armchair ﷼1'</script>"+page("POÄNG Armchair ﷼479");
 assert.equal(visibleIkeaPriceFromHtml(html,title).price,479);
});
test("rejects duplicate root modules and missing currency symbol",()=>{
 assert.equal(visibleIkeaPriceFromHtml(page("POÄNG Armchair ﷼479")+page("POÄNG Armchair ﷼479"),title).status,"unavailable");
 assert.equal(visibleIkeaPriceFromHtml(page("POÄNG Armchair 479"),title).status,"unavailable");
});
