# R01 — Initial query/source truth corpus

This file is a deterministic, **synthetic** starting corpus: 36 customer query intents (18 Arabic/18 English) across 18 strata, seven labeled model/accessory match cases and eight source-failure taxonomy cases. It does not attest current offers, merchant connectivity, delivery, P95 or source reliability.

The Node test replays real query normalization, intent parsing and exact match classification. It emits a SHA256 of the parsed JSON for future baseline/candidate comparisons. Stage cases are a labeled *glossary* for future adapter instrumentation, **not a test of end-to-end source stage telemetry**. Do not claim S00 finished until recorded public fixtures and a representative production evidence baseline are added and independently validated.

The baseline SHA records the repository revision used when this corpus was designed. The Git blob and commit SHAs protect file content. All changes to the corpus must be reviewed as a policy change, not silently reclassified to make benchmarks green.
