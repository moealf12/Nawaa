import { readJinaPage, jinaReaderConfigured } from "../server/jina-reader.mjs";
import { createHash } from "node:crypto";

// Explicit operator-only probe, never runs as part of customer search.
// Example: JINA_READER_ENABLED=1 JINA_READER_ALLOWED_HOSTS=www.example.org
//          JINA_API_KEY=[from environment] node scripts/probe-jina-reader.mjs https://www.example.org/item
const url = process.argv[2];
if (!url || !jinaReaderConfigured()) {
  console.error("Jina Reader is disabled or missing server-only JINA_API_KEY / exact host allowlist.");
  process.exitCode=2;
} else {
  const result=await readJinaPage(url);
  const report={
    status:result.status,
    targetUrl:result.targetUrl || null,
    retrievedAt:result.retrievedAt || null,
    contentLength:result.content?.length || 0,
    contentSha256:result.content
      ? createHash("sha256").update(result.content).digest("hex")
      : null,
    verifiedOfferCount:0,
    note:"Untrusted discovery text only. No product price is certified by this probe.",
  };
  // Never print API key, request headers, or entire downloaded page.
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
  if (result.status!=="ok") process.exitCode=1;
}
