// Opt-in, read-only live probe: no signing key or database credentials required.
// Example: node scripts/probe-certified-merchant.mjs https://www.ikea.com/sa/en/p/...
import {extractCertifiedMerchantOffer} from "../server/tooling/merchant-observation-producer.mjs";
if(process.argv.length!==3)throw new Error("usage: node scripts/probe-certified-merchant.mjs <IKEA_SA_PRODUCT_URL>");
const result=await extractCertifiedMerchantOffer({sourceId:"ikea-sa",url:process.argv[2]});
console.log(JSON.stringify({mode:"read_only_no_database_write",...result},null,2));
