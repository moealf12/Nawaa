import { writeFile } from "node:fs/promises";
import { auditFreeStorefronts } from "../server/source-audit.mjs";

const audit = await auditFreeStorefronts();
const output = JSON.stringify(audit, null, 2);
await writeFile(process.argv[2] || "source-audit-results.json", output);
console.log(output);
