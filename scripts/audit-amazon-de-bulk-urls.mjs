// Usage: node scripts/audit-amazon-de-bulk-urls.mjs < products.json
// Input: [{"asin":"B0FQFW3423","product_url":"https://www.amazon.de/dp/B0FQFW3423"}]
// Output: read-only link health, never prices or merchant certification.
import { readFileSync } from "node:fs";
import { processProductsBulk } from "../server/amazon-de-bulk-url-health.mjs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const products = Array.isArray(input) ? input : input?.products;
  const requested = Array.isArray(input) ? 4 : input?.concurrencyLimit ?? 4;
  const result = await processProductsBulk(products, requested);
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.failed > 0) process.exitCode = 2;
} catch (error) {
  process.stderr.write("AMAZON_DE_URL_AUDIT_ERROR " +
    JSON.stringify({ code: error instanceof SyntaxError ? "INVALID_JSON" : "INVALID_BATCH" }) + "\n");
  process.exitCode = 1;
}
