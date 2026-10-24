// Pure, deterministic source-coverage metric. Multiple successful queries
// against one merchant do not prove coverage of multiple live merchants.
// Kept separate from the networked validation script for CI regression tests.
export function countDistinctLiveMerchants(rows) {
  const stores = new Set();
  for (const row of rows || []) {
    if (row?.status !== "LIVE_VALIDATED") continue;
    const store = String(row.store || "").trim().toLowerCase();
    if (store) stores.add(store);
  }
  return stores.size;
}
