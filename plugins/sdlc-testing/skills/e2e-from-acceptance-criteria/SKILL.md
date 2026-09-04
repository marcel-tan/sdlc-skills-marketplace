---
name: e2e-from-acceptance-criteria
description: Translate a story's Given/When/Then acceptance criteria into end-to-end or integration tests (Playwright, Cypress, API-level, or the repo's e2e framework), wired into CI with stable selectors and seeded data. Use when asked to write e2e tests, automate acceptance tests, or verify a story's behavior end to end.
metadata:
  stage: testing
  tags: [e2e, integration, playwright, cypress, acceptance-tests]
  inputs: [story or ticket with acceptance criteria, running app or instructions to start it]
  outputs: [one e2e test per AC, CI wiring, run report with traces/screenshots for failures]
  next: [sdlc-testing:flaky-test-triage, sdlc-pr-review:pr-review]
---

# E2E tests from acceptance criteria

Available as `/sdlc-testing:e2e-from-acceptance-criteria`.

## Steps

1. Find the existing e2e setup: framework (`playwright.config.*`,
   `cypress.config.*`, `k6`, `supertest`, `pytest` + `httpx`), how the app is
   started for tests, how data is seeded, how auth is handled. Reuse all of
   it. If none exists, propose the smallest setup that matches the stack and
   confirm before adding a framework.
2. Map each acceptance criterion to exactly one test. Test name = the AC text
   (`test('AC2: given an empty cart, checkout is disabled')`). Keep the
   story/AC ID in the name for traceability.
3. Build the test from the Given/When/Then:
   - **Given** → seed via API/fixtures, never via UI clicks. Prefer
     per-test isolated data (unique IDs) over shared state.
   - **When** → the single user action under test.
   - **Then** → assert on user-observable outcomes (visible text, URL,
     network response, DB row via API), with auto-waiting assertions.
4. Selectors: use role/label/test-id selectors (`getByRole`,
   `data-testid`). Add `data-testid` to the app only where no semantic
   selector exists. Never use CSS paths or nth-child.
5. Run each test 3 times locally (`--repeat-each=3`) to catch flakiness
   before it reaches CI.
6. Wire into CI following the existing e2e job; upload traces/screenshots on
   failure. Keep total added runtime under the team's budget; parallelize if
   needed.
7. Record the AC → test mapping in the PR description, and mark any AC that
   cannot be automated (e.g. sends real email) with the manual check instead.

## Do not

- Sleep for fixed durations; use framework auto-wait or explicit condition
  waits.
- Chain tests so one depends on another's side effects.
- Assert on implementation details (class names, internal state).

## Hand-off

If any test is unstable, run `/sdlc-testing:flaky-test-triage`. Then request
`/sdlc-pr-review:pr-review`.
