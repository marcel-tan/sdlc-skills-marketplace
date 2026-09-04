---
name: flaky-test-triage
description: Reproduce, root-cause, and fix (or quarantine with a ticket) a flaky test using CI history, repeated local runs, and the common flake taxonomy - timing, shared state, order dependence, resource leaks, external services. Use when a test fails intermittently, CI is red without a related change, or asked to stabilize a suite.
metadata:
  stage: testing
  tags: [flaky, ci, stability, quarantine, root-cause]
  inputs: [failing test name(s) and CI run URL(s), target repo]
  outputs: [fix PR with root cause, or quarantine PR + tracker ticket with reproduction notes]
  next: [sdlc-pr-review:pr-review]
---

# Flaky test triage

Available as `/sdlc-testing:flaky-test-triage`.

## Steps

1. **Gather evidence.** Pull the last N CI runs for the test (CI provider
   API/MCP, or the repo's flaky-test dashboard). Record pass/fail rate, which
   runners/shards fail, time of day, and whether failures cluster after a
   specific commit. Save the failing logs/traces.
2. **Reproduce.** Run the test repeatedly in isolation and in the full suite
   (`--repeat-each=20`, `pytest --count`, `go test -count=50 -race`,
   `dotnet test` in a loop). Try with reduced CPU (`taskset`, `nice`) and
   randomized order (`--random-order`, `-shuffle=on`) to expose timing and
   order dependence.
3. **Classify** using the taxonomy:
   - *Timing*: fixed sleeps, races between async work and assertions,
     animation waits.
   - *Order / shared state*: module-level mutable state, DB rows shared
     between tests, unreset mocks, environment variables.
   - *Resource*: ports, temp files, leaked handles, memory pressure on CI.
   - *External*: real network calls, clocks/time zones, locale, randomness
     without a seed.
   - *Product bug*: the flake is a real race in the code under test — treat
     as a defect, not a test problem.
4. **Fix at the root.** Examples: replace sleeps with condition waits;
   isolate state per test; inject clock/random; mock the external service
   at the boundary; fix the product race. Do not add retries or widen
   timeouts as the fix unless the cause is genuinely a slow but correct
   dependency — and say so.
5. **Verify** with the same repeated runs from step 2 (0 failures in 50
   runs, or the team's threshold), including under CPU pressure.
6. **Quarantine only if** root cause is not found within the time box.
   Mark it with the framework's skip/quarantine mechanism, link a ticket
   containing all evidence from steps 1–3, and set a revisit date. Never
   delete a test to make CI green.

## PR description

```markdown
## Flaky test: <name>
**Failure rate:** 7/50 CI runs (last 14 days), shards 2 and 4 only
**Root cause:** <one paragraph, category from taxonomy>
**Fix:** <what changed and why it removes the cause>
**Verification:** 0/100 failures locally with --repeat-each=100 under `nice -n 19`
```

## Hand-off

Request `/sdlc-pr-review:pr-review`. If a product bug was found, file it via
`/sdlc-stories:create-tickets`.
