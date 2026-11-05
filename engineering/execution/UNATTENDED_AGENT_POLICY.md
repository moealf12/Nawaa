# NAWAA unattended development — bootstrap policy

Status: PROPOSED / INACTIVE. This document does not start an agent or authorize API spend.

## Scope
- Repository: moealf12/Nawaa
- Durable plan: `engineering/execution/rounds.json`; treat its statuses as claims requiring exact-SHA evidence.
- On startup re-read main SHA, open PRs and their base/head relationships, workflow results, current production SHA and active tasks.
- Preserve existing R04 work, including PR #322 (P54) and PR #325 (P55); never overwrite their branches.

## Allowed
- Read repository and CI evidence.
- Propose bounded, evidence-grounded tasks and implement changes on fresh isolated branches.
- Run deterministic tests and authorized, bounded live-source acceptance checks.
- Create **draft** pull requests with tested SHA, baseline/candidate measurements, negative controls, failures and cost evidence.

## Forbidden without explicit human approval
- Merge, push directly to main, deploy, change production configuration, mutate production data, change secrets, grant permissions, purchase services, or increase API spending limits.
- Bypass merchant access restrictions or fabricate source evidence.
- Start a second task when a conflicting branch or unfinished PR already owns the same scope.

## Scheduler and lease design (not implemented)
- Poll no more frequently than every 10 minutes, subject to platform minimums and usage quotas.
- Acquire one exclusive lease per workstream using an atomic remote state transition, not just a local file.
- Lease records owner, task id, base SHA, head SHA, acquired_at, expires_at, heartbeat and run URL.
- A lease expiry does not imply safe takeover: first reconcile GitHub branches, PRs, Actions runs and any external agent sessions.
- Use idempotency key `round:package:baseSHA:scopeHash`; cap retries, concurrency, tool calls, wall time and tokens.
- Stop on conflicting state, missing evidence, failed checks, rate limits, exhausted budget, or upstream access denial.
- Never treat a green CI workflow alone as production verification.

## Acceptance
1. Exact-head tests pass and required CI checks are non-skipped.
2. No product identity, condition, price, provenance or JSON/SSE parity regression.
3. Any live claim is backed by actual timestamped upstream observations, not fixtures.
4. Draft PR includes reproducible evidence, cost accounting and explicit GO/NO-GO.
5. Human approves merge and production deploy.

## Pending prerequisites
- Confirm whether to use Codex hosted tasks or API-driven agents; the API key alone is not a running agent.
- Establish a maximum API spend and a hard enforcement mechanism.
- Verify the agent runtime, repository access scope, secret storage, scheduler/lease and kill switch.
- Test one supervised dry run before enabling unattended execution.
