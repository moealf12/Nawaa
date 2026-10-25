# Render on-commit deployment diagnostic canary — 2026-10-25

This file is a **documentation-only** Git change for the authorized investigation in [Issue #118](https://github.com/moealf12/Nawaa/issues/118).

## Test design

- Baseline before this canary: GitHub `main` and Render LIVE both at `0cec085a6ca6c48468f4d16af1e78cb27823a2f1`.
- Render service: `srv-dau4olo93c1s73cnj9a0`, branch `main`, auto-deploy setting `yes` / `commit`.
- Merge this documentation-only PR into `main` after confirming no unrelated changes.
- Observe a **new** Render deployment with `trigger: commit` or event evidence attributable to Git provider, and commit SHA equal to the new GitHub main.
- Require LIVE status, matching `/health.revision` and a read-only post-LIVE smoke to declare the diagnostic passed.
- If no automatic deployment appears, record this as unresolved. **Do not trigger a manual/API deployment during the observation**, as it would contaminate the test.

## Scope

No source code, dependencies, environment variables, database schema/data, production trust flags, search algorithms, paid infrastructure, or deploy automation changes. This canary does not certify product authenticity or latency.
