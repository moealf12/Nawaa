# R02 — Post-deployment cache admission acceptance

Runs existing `NAWAA Live Production Source Acceptance` workflow at the
certification PR, pinned to its base SHA already confirmed LIVE on Render.
The script adds R02 assertions to the eight real Arabic/English JSON queries
and four SSE sessions. A second immediate PS5 JSON request checks that a
partial first cache miss does not create a 45-second FRESH entry.

Strict invariants: no partial result can be presented as FRESH or complete,
consistent complete evidence can still be served normally, real valid offers
are preserved, SSE completes, and source failures stay visible. A second
query may produce a complete response: it is not required to remain partial.

Measured latencies are a very small real-production sample; no P95, global
recall, or zero-performance-regression claim may be inferred. Sources that
did not answer remain unknown, never out of stock. This job makes only
bounded public API requests, no direct merchant calls or writes.

R02 remains IN_PROGRESS until the workflow passes and evidence is
independently checked and committed.
