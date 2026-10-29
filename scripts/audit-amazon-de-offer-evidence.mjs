// Read-only, operator-supplied single Amazon.de PDP diagnostic.
// Usage: echo '{"asin":"B0FQFW3423","url":"https://www.amazon.de/dp/B0FQFW3423"}' |
//        node scripts/audit-amazon-de-offer-evidence.mjs
// Output contains no price, seller identity, raw page HTML or credentials.
import { readFileSync } from "node:fs";
import { probeAmazonDeOffer } from "../server/amazon-de-offer-evidence.mjs";

try {
  const raw = readFileSync(0, "utf8");
  if (Buffer.byteLength(raw) > 2048) throw Error("INPUT_TOO_LARGE");
  const request = JSON.parse(raw);
  if (!request || Array.isArray(request) || typeof request !== "object") throw Error("INVALID_INPUT");
  const evidence = await probeAmazonDeOffer({
    asin: request.asin, url: request.url, timeoutMs: 6000,
  });
  process.stdout.write("NAWAA_AMAZON_DE_OFFER_EVIDENCE " + JSON.stringify(evidence) + "\n");
  if (evidence.status !== "SAME_PAGE_PARITY_CANDIDATE_NOT_ATTESTED") process.exitCode=2;
} catch {
  process.stderr.write("NAWAA_AMAZON_DE_OFFER_EVIDENCE_ERROR INVALID_INPUT_OR_REQUEST\n");
  process.exitCode=1;
}
