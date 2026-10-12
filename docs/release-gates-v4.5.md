# NAWAA Phase Zero — Release-gate readiness (review only)

**Status:** proposed configuration; branch protection NOT applied and production NOT activated.

## Required GitHub status checks

Protect `main` with the **exact job contexts**, each from GitHub Actions:

| Workflow | Stable job id / check context | Scope |
| --- | --- | --- |
| Search Core Tests | `test` | `npm test`, syntax checks, PR synthetic merge checkout |
| NAWAA Phase Zero Persistence V2 Evidence | `ephemeral-postgres` | All `tests/ephemeral/*.test.mjs`, isolated PostgreSQL 16 |

The two workflows MUST report a status on **every pull request**, including documentation-only
and workflow-only changes. Avoid `pull_request.paths`, `paths-ignore`, branch filters
and job-level skip conditions in REQUIRED workflows: skipped workflows can leave
required checks permanently pending. `push: main` search filters are non-required
and remain separate.

PR checkout provenance must verify `refs/pull/<number>/merge` and
`git rev-parse HEAD == GITHUB_SHA`. The two checks must pass on the **same**
source PR head and current main base. The checked-out test merge commit is not
itself a repository merge or production deployment.

## Recommended owner-approved branch protection

Repository → Settings → Branches → Add branch protection rule → branch `main`.

1. Require a pull request before merging (at least one independent approving review recommended).
2. Require status checks before merging, **strict / up-to-date**.
3. Select exact contexts `test` and `ephemeral-postgres`; expected source GitHub Actions.
4. Require conversation resolution; dismiss stale approvals after new commits when available.
5. Do not allow force pushes or branch deletion; include administrators / disable bypass when supported.
6. Recheck status names in the GitHub PR checks panel before saving (names could be
   prefixed with workflow name depending on GitHub UI).
7. Make a documentation-only test pull request to confirm both required checks report.
8. Review the verified PR diff and approve any merge explicitly; do not deploy V2.

Rulesets / branch protection do not appear to be active at the time of this audit.
**This document must not be treated as authorization to change repository settings.**

## Cost and scope

Repository visibility verified as public. GitHub documents that standard GitHub-hosted
runners are free for public repositories. Always running the PostgreSQL workflow
trades approximately one ephemeral CI job per PR for guaranteed status reporting.
No new paid service, deployment, external API credential or persistent database
was added.

If runner efficiency becomes a real concern, redesign to an always-reporting
required aggregate gate with a separately verified, change-aware heavy PostgreSQL
job; do NOT quietly reintroduce workflow-level path filters.

Official docs:
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

## Merge decision matrix

| Evidence | Required | Current interpretation |
| --- | --- | --- |
| Search Core against PR merge SHA | Green | Technically necessary, not sufficient |
| PostgreSQL all ephemeral suites against same merge SHA | Green | Technically necessary, not sufficient |
| Canonical identity, price/currency and observations | Regression tests and independent review | Needed |
| Branch protection and required contexts | Owner approval | Not yet configured |
| Independent review of accumulated persistence diff | Approval | Not yet provided |
| Live V2 ingestion or production deployment | Separate explicit authorization | Not permitted |

`main` is intentionally unchanged and V2 remains an opt-in / ephemeral-only prototype.
