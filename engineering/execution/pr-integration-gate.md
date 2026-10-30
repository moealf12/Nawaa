# R01 mandatory PR evidence gate

The protected status context remains nawaa-required-pr-check. The final aggregator runs after same-workflow core and isolated integration jobs, always evaluating both results and the exact PR head SHA.

The integration job tests PostgreSQL chronology, Meilisearch restart and replay, Python extraction/identity contracts and the JSONL Node-Python bridge. Tests inject failures into the gate decision function to verify that missing, skipped, failed or cancelled jobs cannot produce a passing result.

This is a subset of source, browser and Omega system tests. Those still run in other CI paths and must not be described as automatically enforced by this new aggregate. CI uses hosted runner minutes: the zero-paid requirement is contingent on GitHub free-minute quota. R01 remains IN_PROGRESS until baseline source fixtures and final acceptance evidence are complete.
