# R02 — RED test baseline

This branch intentionally starts with failing tests showing that valid partial search results enter the canonical 45-second cache as fresh. RED is expected on the baseline and not promotable. Only after the admission classifier, generation-aware diagnostics, and complete/partial contracts pass all required tests can R02 be merged.

The currently deployed R01 live sample returned partial coverage for every tested query. An exact correctness fix may increase source fan-out; deployment acceptance must measure cache-hit behavior, concurrency, request rate and partial retry burden. No global shopping completeness is implied by complete=true for a bounded acquisition wave.
