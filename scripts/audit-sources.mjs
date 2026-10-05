import { writeFile } from "node:fs/promises";
import { auditFreeStorefronts } from "../server/source-audit.mjs";

const AUDIT_TIMEOUT_MS = Math.max(1_000, Number(process.env.NAWAA_AUDIT_TIMEOUT_MS) || 25 * 60 * 1_000);

async function main() {
  let timeout;
  try {
    const audit = await Promise.race([
      auditFreeStorefronts(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Live Source Audit timed out after ${AUDIT_TIMEOUT_MS}ms`)),
          AUDIT_TIMEOUT_MS,
        );
      }),
    ]);
    const output = JSON.stringify(audit, null, 2);
    await writeFile(process.argv[2] || "source-audit-results.json", output);
    console.log(output);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
