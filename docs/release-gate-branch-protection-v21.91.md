# NAWAA v21.91 — main branch protection activation

Status: **NOT ACTIVE** until an administrator saves and independently verifies the GitHub rule.
Last inspected production main: `cc1dc158501a4b8670f5d738f2055fa0a7d6ea67`. Re-read before use.

## Why this is necessary

- GitHub `main` had `protected: false`; no branch rulesets were active.
- The existing Search Core PR workflow is **path-filtered**, so requiring any of its five jobs directly can make documentation-only PRs wait for a check that never ran.
- The existing `main-release-readiness` job is **main-push-only**, and correctly skips on pull requests. Never make that job a required PR check.
- Render is already `autoDeployTrigger: checksPass`. Render's gating is not a replacement for GitHub branch protection.

## Required PR check

`.github/workflows/required-pr-check.yml` publishes a single unique, always-on job name:

`nawaa-required-pr-check`

It runs on every normal pull request, regardless of changed paths or draft state. It pins checkout to the event's exact PR HEAD SHA, compares the Git checkout SHA, installs locked dependencies without lifecycle scripts and executes `npm test` using disposable/no-production env values. Missing, cancelled, stale or failed runs are not valid passing check conclusions. The job is not `continue-on-error` and has no skip conditional.

This deliberately costs one additional standard GitHub Actions job per PR. The repository is public, so ordinary GitHub-hosted Actions do not require new paid infrastructure. Re-evaluate usage if the repository becomes private or the platform changes.

## One-time admin steps

Repository: https://github.com/moealf12/Nawaa

1. Merge this PR only after the exact-HEAD candidate workflow `nawaa-required-pr-check` passes. It is a CI-only change; Git-triggered Render production deployment remains behind post-merge main checks.
2. In **Settings → Branches → Add classic branch protection rule**, set **Branch name pattern** to `main`. Alternatively use an active main-targeted repository ruleset.
3. Enable **Require a pull request before merging**.
4. Enable **Require status checks to pass before merging** and select precisely `nawaa-required-pr-check` with **GitHub Actions** as its expected source if prompted.
5. Enable **Require branches to be up to date before merging** (strict mode) to avoid merging a stale head against a changed main. Rebase or update affected PR branches when blocked.
6. Enable **Require conversation resolution before merging** if review comments are used. Do not require approval counts that a solo owner cannot satisfy.
7. Disallow force pushes and branch deletion; consider **Do not allow bypassing the above settings** after verifying the app/workflow can merge an ordinary validated PR. Do not add undocumented bypass actors.
8. Save the rule. Check that GitHub now reports `main.protected=true` and that a clean test PR without application file changes creates a successful `nawaa-required-pr-check` status.
9. Confirm an untested or failing PR cannot be merged and that a valid tested PR can, without forcing a real production failure or customer-impacting deploy.

## Must NOT select as required PR checks

- `main-release-readiness` — it intentionally runs only on main pushes and is skipped on PRs.
- Path-filtered `test`, `disposable-postgres-provenance`, `disposable-omega-consistency`, `disposable-meilisearch-restart`, `disposable-quote-lifecycle`, and `Live Source Audit` until their PR-trigger semantics are redesigned.
- Any Pages/Render postdeployment status; postdeployment acceptance cannot be required before deployment.

## Existing production gates remain

After a reviewed PR merges, `Search Core Tests` runs on **every** main push, and `main-release-readiness` depends on the five mandatory jobs with exact-SHA verification and fails if any is absent, skipped or failed. Render must stay in **After CI Checks Pass**. Render success alone does not prove independent HTTP/browser acceptance.

## Validation and rollback

- Positive: all-PR check on exact candidate HEAD PASS; main CI exact resulting SHA 6/6 PASS; Render starts after successful checks; public `/health` SHA matches GitHub main.
- Negative (safe): policy unit tests prove missing/failed/stale cases rejected; inspect GitHub UI protection settings without generating a deliberately failing main commit.
- No production database changes, no secrets, no manual deploy.
- If branch rule causes PR deadlock, correct the required-check selection (do **not** disable actual CI assertions or force push).
- If the new workflow malfunctions before branch rule activation, keep the PR draft/unmerged and fix independently.
- Never claim that the administrator configured the rule until the actual active policy is re-read and verified.
