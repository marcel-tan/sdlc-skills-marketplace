# Epic: Usage-based billing for launched Devin sessions

**Spec:** [usage-based-billing.md](./usage-based-billing.md) | **Scale:** story points (1/2/3/5/8; 8 is "large") | **Total:** 34 pts

## Goal

Attribute every Devin session launched through `sdlc-skills-mcp` to a billable
account, record its ACU consumption durably, enforce a monthly ACU budget at
launch, and expose usage and statements to callers, admins, and the launcher
UI.

## Stories in order

| # | Story | Traces to | Depends on | Pts |
|---|-------|-----------|------------|-----|
| STORY-1 | Attribute launches to the caller's account and persist a usage ledger (walking skeleton) | R1, R2, R3, R11 | — | 8 |
| STORY-2 | Track ACU consumption of launched sessions until they finish | R4, R11 | STORY-1 | 5 |
| STORY-3 | Reject launches that would exceed the account's monthly ACU budget | R5, R11 | STORY-2 | 5 |
| STORY-4 | Let callers query their own usage via API and MCP tool | R6, R10, R12 | STORY-2 | 3 |
| STORY-5 | Produce a monthly statement per account from its rate plan | R7 | STORY-4 | 3 |
| STORY-6 | Give admins an all-accounts usage view and CSV export | R8, R12 | STORY-5 | 3 |
| STORY-7 | Show month-to-date usage and budget errors in the launcher UI | R9 | STORY-3, STORY-4 | 3 |
| SPIKE-1 | Confirm the Devin session API exposes ACU consumption (time box: 2 h) | R4 (Q1) | — | 1 |

Dependencies are ordering constraints; each story is mergeable on its own
because the feature is inert without `BILLING_CONFIG` / `BILLING_DATA_DIR`.
Riskiest first after the skeleton: STORY-2 depends on an unconfirmed API field
(SPIKE-1 runs in parallel with STORY-1), STORY-3 has the concurrency case.

## Out of scope (from spec non-goals)

- NG1 Collecting payment (card processing, Stripe/Chargebee, tax).
- NG2 Billing for anything other than Devin sessions launched through this server.
- NG3 Replacing Devin's own org-level ACU accounting.
- NG4 Multi-currency, proration, credits/refunds, discounts beyond a flat included allowance.
- NG5 Self-service signup.
- NG6 Per-user attribution inside an account.

---

### SPIKE-1: Confirm the Devin session API exposes ACU consumption
**As a** developer **I want** to know the exact v1/v3 session-response field for ACU used and its update latency **so that** STORY-2 can be estimated without guesswork.

**Traces to:** R4 (Open question Q1)
**Depends on:** —
**Estimate:** 1 (time box 2 h)

**Acceptance criteria**
- Given a running session created via `POST /v1/sessions` and one via `/v3/organizations/{org}/sessions`, when `GET` is called on each, then the field name and type carrying ACU consumption is recorded for both in the spec's Open question Q1 (or "absent" is recorded and the R4 fallback is confirmed).
- Given the field exists, when a session finishes, then the observed lag between `finished` and the final ACU value is recorded.

**Technical notes**
- Touches: `docs/specs/usage-based-billing.md` (Q1), a fixture JSON under `mcp-server/test/` capturing a real response shape (redacted).
- Needs `DEVIN_API_KEY` in the session.

**Out of scope**
- Any code change beyond test fixtures.

---

### STORY-1: Attribute launches to the caller's account and persist a usage ledger
**As an** operator **I want** every launched session recorded against the account whose token launched it, surviving restarts, **so that** I can attribute Devin spend to teams.

**Traces to:** R1, R2, R3, R11
**Depends on:** —
**Estimate:** 8  ← **walking skeleton**

**Acceptance criteria**
- Given only `MCP_AUTH_TOKEN` is set, when a session is launched with it, then the usage record has `accountId: "default"`. (R1-AC1)
- Given `BILLING_CONFIG` defines `alpha` and `beta`, when a session is launched with `beta`'s token via `POST /api/sessions`, then the record has `accountId: "beta"`. (R1-AC2)
- Given `BILLING_CONFIG` defines accounts, when `start_devin_session` is called over `/mcp` with `beta`'s token, then the record has `accountId: "beta"`. (R1-AC4)
- Given a token matching no account, when any `/api/*` or `/mcp` request is made, then the response is 401 with `WWW-Authenticate: Bearer`. (R1-AC3)
- Given both `BILLING_CONFIG` and `MCP_AUTH_TOKEN` are set, when the server starts, then both the configured tokens and `MCP_AUTH_TOKEN` (as `default`) authenticate and stderr logs `loaded 2 billing accounts`. (R2-AC1, R2-AC3)
- Given an account missing `token`, or two accounts sharing a token, when the server starts, then it exits non-zero naming `accounts[<i>].token` / the duplicate. (R2-AC2, R2-AC4)
- Given an account uses `tokenEnv: "ALPHA_TOKEN"`, when the server starts, then the token is read from that env var.
- Given a session was launched, when the process restarts with the same `BILLING_DATA_DIR`, then `GET /api/sessions` (scoped to the account) still lists it. (R3-AC1)
- Given `BILLING_DATA_DIR` is unwritable, when the server starts in HTTP mode, then it exits non-zero naming the directory. (R3-AC2)
- Given `BILLING_DATA_DIR` is unset, when the server starts, then stderr logs `BILLING_DATA_DIR not set; usage records are not persisted` and launches still work. (R3-AC3)
- Given `usage.jsonl` ends in a truncated line, when the server starts, then remaining records load and one warning is logged. (R3-AC4)
- Given `alpha` launched a session, when `beta` calls `GET /api/sessions/<id>`, then the response is 404. (R6-AC4)
- Given any log line written by billing code, then it contains neither a bearer token nor the Devin API key. (R11)

**Technical notes**
- New `mcp-server/src/billing.ts`: `loadBillingConfig(env)` (zod schema), `Ledger` (replay JSONL, `append`, `latestBySession`, compaction at 50 MB), `Account` type.
- `mcp-server/src/bin.ts`: replace `bearerMatches` with `resolveAccount(req): Account | undefined` using `timingSafeEqual` per account; pass `account` into `createApiHandler` (per request) and `createServer({ catalog, devin, account })`.
- `mcp-server/src/api.ts`: replace the `launched` array with the ledger; scope `GET /api/sessions` and `GET /api/sessions/:id` by `account.id`; `MAX_LAUNCHED` cap is dropped.
- `mcp-server/src/server.ts`: `start_devin_session` writes a ledger record.
- Tests: `mcp-server/test/billing.test.ts` (config validation, replay, truncated line), extend `api.test.ts` and `server.test.ts` for attribution and scoping.
- README: document `BILLING_CONFIG`, `BILLING_DATA_DIR`, `tokenEnv`.
- Flag: none needed — inert unless env vars are set.

**Out of scope**
- ACU refresh (STORY-2), budgets (STORY-3), any new read routes (STORY-4).

---

### STORY-2: Track ACU consumption of launched sessions until they finish
**As an** operator **I want** each usage record's `acuUsed` kept current until the session ends **so that** attribution reflects real cost, not just launches.

**Traces to:** R4, R11
**Depends on:** STORY-1, SPIKE-1
**Estimate:** 5

**Acceptance criteria**
- Given a running session that Devin reports with 3.5 ACU used, when 5 minutes elapse (fake timers), then the record shows `acuUsed: 3.5`. (R4-AC1)
- Given a session in state `running`, when `GET /api/sessions/:id` is called, then the record's `acuUsed` and `status` are updated from the response.
- Given a session reached `finished` with `acuUsed: 7`, when Devin later returns a different value, then the record still shows 7 and no further refresh call is made for it. (R4-AC2)
- Given Devin returns 5xx during a refresh, when the refresh runs, then the previous `acuUsed` is retained, stderr logs `usage refresh failed` with `accountId` and `sessionId`, and the next tick still runs. (R4-AC3, R11)
- Given Devin's response has no ACU field, when the refresh runs, then `acuUsed` is `null` and status still updates.
- Given stdio mode or no `DEVIN_API_KEY`, when the server starts, then no refresh interval is created.

**Technical notes**
- `mcp-server/src/devin.ts`: `SessionStatus.acuUsed: number | null` parsed from the field confirmed by SPIKE-1 (both v1/v3 shapes in `normalizeSession`).
- `mcp-server/src/billing.ts`: `startRefreshLoop(ledger, devin, fetchImpl, intervalMs = 300_000)` returning a `stop()`; `setInterval(...).unref()`.
- `mcp-server/src/bin.ts`: start the loop in HTTP mode when `devin` is configured; stop on shutdown.
- Tests: `vi.useFakeTimers()` in `billing.test.ts`; extend `devin.test`-style fixtures in `api.test.ts`.

**Out of scope**
- Budget enforcement, statements.

---

### STORY-3: Reject launches that would exceed the account's monthly ACU budget
**As an** operator **I want** launches refused once a team's committed ACU for the month would exceed its budget **so that** one team cannot exhaust the shared Devin credits.

**Traces to:** R5, R11
**Depends on:** STORY-2
**Estimate:** 5

**Acceptance criteria**
- Given `alpha` has `monthlyAcuBudget: 100` and 95 ACU committed, when it launches with `maxAcuLimit: 10`, then the response is 402 with `{ error, accountId, budget: 100, committed: 95, requested: 10, resetsAt }` and no Devin API call is made. (R5-AC1)
- Given the same account, when it launches with `maxAcuLimit: 5`, then the session is created (201). (R5-AC2)
- Given a budgeted account, when it launches without `maxAcuLimit`, then the response is 400 with `maxAcuLimit is required for budgeted accounts`. (R5-AC3)
- Given an account without a budget, when it launches without `maxAcuLimit`, then the session is created. (R5-AC4)
- Given `dryRun: true` and a launch that would exceed the budget, then the response is 200 with `dryRun: true` and `budgetCheck: { ok: false, ... }` and nothing is recorded. (R5-AC5)
- Given two concurrent launches that each fit but together exceed, when both are processed, then at most one succeeds. (R5-AC6)
- Given a running session with `maxAcuLimit: 20` and 2 ACU used, when the check runs, then it counts 20 toward committed ACU. (R5-AC7)
- Given the Devin call fails after a reservation, when the error is returned, then the reservation is released and a subsequent fitting launch succeeds.
- Given `start_devin_session` over `/mcp` would exceed the budget, then the tool returns an MCP error whose message contains `budget exceeded` and the same figures.
- Given a rejection, then one stderr line contains `budget exceeded`, the `accountId`, and the figures, and no token. (R11-AC1)

**Technical notes**
- `mcp-server/src/billing.ts`: `committedAcu(accountId, month)`, `reserve(accountId, maxAcuLimit)` → `Reservation` with `commit(record)` / `release()`; `resetsAt(month)`.
- `mcp-server/src/api.ts` `POST /api/sessions` and `mcp-server/src/server.ts` `start_devin_session`: reserve → `createDevinSession` → commit/release; new `HttpError(402, ...)` with `details`.
- Tests: concurrency via two un-awaited `route()` calls with a deferred fetch mock.

**Out of scope**
- UI rendering of the 402 (STORY-7).

---

### STORY-4: Let callers query their own usage via API and MCP tool
**As a** team lead **I want** to see my account's month-to-date ACU, budget, and sessions **so that** I know how much headroom I have before launching.

**Traces to:** R6, R10, R12
**Depends on:** STORY-2
**Estimate:** 3

**Acceptance criteria**
- Given `alpha` launched 3 sessions totalling 12.5 ACU against budget 100, when it calls `GET /api/usage`, then the body is `{ accountId: "alpha", month, acuUsed: 12.5, sessionCount: 3, budget: 100, remaining: 87.5 }`. (R6-AC1)
- Given no sessions this month, then `acuUsed: 0, sessionCount: 0, remaining: budget`, or `budget: null, remaining: null` without a budget. (R6-AC2)
- Given `GET /api/usage/sessions?month=2026-08`, then only that month's records are returned, newest first; `?month=2026-13` returns 400. (R6-AC3)
- Given `beta` has records, when `alpha` calls either route, then none of `beta`'s records appear. (R6)
- Given an MCP client calls `get_usage` over `/mcp` with `alpha`'s token, then the result equals the `GET /api/usage` payload for `alpha`. (R10-AC1)
- Given stdio mode, when `get_usage` is called, then it returns the `default` account's in-memory totals. (R10-AC2)
- Given 10,000 records for one account in the month, when `GET /api/usage` is called 100 times, then p95 < 200 ms. (R12-AC1)

**Technical notes**
- `mcp-server/src/billing.ts`: `usageSummary(accountId, month)`, `usageSessions(accountId, month)`, `parseMonth()`; keep a per-account-month running total so the summary is O(1).
- `mcp-server/src/api.ts`: `/api/usage`, `/api/usage/sessions`.
- `mcp-server/src/server.ts`: `get_usage` tool (`readOnlyHint: true`).
- Tests: `api.test.ts`, `server.test.ts`, a perf test in `billing.test.ts` seeded with 10k records.

**Out of scope**
- Money (STORY-5), other accounts' data (STORY-6).

---

### STORY-5: Produce a monthly statement per account from its rate plan
**As an** operator **I want** a per-account statement with billable ACU and amount **so that** I can charge back to cost centers without spreadsheet work.

**Traces to:** R7
**Depends on:** STORY-4
**Estimate:** 3

**Acceptance criteria**
- Given plan `{ pricePerAcu: 2.5, includedAcu: 10, currency: "USD" }` and 12.5 ACU used, when `GET /api/billing/statement?month=` is called, then `billableAcu: 2.5`, `amount: 6.25`. (R7-AC1)
- Given 8 ACU used against `includedAcu: 10`, then `billableAcu: 0`, `amount: 0`. (R7-AC2)
- Given no `plan`, then `plan: null`, `amount: null`, and usage fields are present. (R7-AC3)
- Given `pricePerAcu: 0.333`, `billableAcu: 1`, then `amount: 0.33` (half-up, 2 decimals). (R7-AC4)
- Given a still-running session in the month, then it is listed with `status: "running"` and the statement has `final: false`; otherwise `final: true`. (R7-AC5)
- Given `beta`'s token, then only `beta`'s statement is returned.

**Technical notes**
- `mcp-server/src/billing.ts`: `statement(account, month)`; rounding via integer cents (`Math.round(x * 100 + Number.EPSILON) / 100`).
- `mcp-server/src/api.ts`: `/api/billing/statement`.
- Tests: pure-function cases in `billing.test.ts`.

**Out of scope**
- Payment, proration, discounts (NG1, NG4).

---

### STORY-6: Give admins an all-accounts usage view and CSV export
**As an** operator **I want** one call that returns every account's statement for a month, as JSON or CSV, **so that** month-end chargeback is a single download.

**Traces to:** R8, R12
**Depends on:** STORY-5
**Estimate:** 3

**Acceptance criteria**
- Given an account with `admin: true`, when it calls `GET /api/admin/usage?month=2026-08`, then the body lists every account's statement, including zero-usage accounts. (R8-AC1)
- Given a non-admin account, when it calls any `/api/admin/*` route, then 403. (R8-AC2)
- Given `GET /api/admin/usage.csv`, then `content-type: text/csv` and one row per account with columns `accountId, month, acuUsed, includedAcu, billableAcu, pricePerAcu, amount, currency`. (R8-AC3)
- Given no admin account is configured, when the server starts, then it logs `no admin account configured; /api/admin routes are disabled` and those routes return 404. (R8-AC4)
- Given 10 accounts × 1,000 records, when the admin route is called 100 times, then p95 < 200 ms. (R12)

**Technical notes**
- `mcp-server/src/api.ts`: `/api/admin/usage`, `/api/admin/usage.csv` (CSV fields quoted; no user-controlled strings other than `accountId`, which is `^[a-z0-9-]+$`).
- `mcp-server/src/billing.ts`: `allStatements(month)`.
- Tests: `api.test.ts`.

**Out of scope**
- Admin write operations (accounts are file-configured, NG5).

---

### STORY-7: Show month-to-date usage and budget errors in the launcher UI
**As a** team lead using the launcher **I want** to see my remaining ACU and a clear message when a launch is refused for budget **so that** I can adjust `maxAcuLimit` or wait for the reset without reading server logs.

**Traces to:** R9
**Depends on:** STORY-3, STORY-4
**Estimate:** 3

**Acceptance criteria**
- Given the UI is loaded with a valid token, then a "Usage this month" panel shows `acuUsed / budget` and `remaining` (or `acuUsed` and "no budget"), refreshed on the existing 15 s poll. (R9-AC1)
- Given a launch returns 402, then the error is rendered inline under the Launch button with `committed`, `requested`, `budget`, and `resetsAt` from the response. (R9-AC2)
- Given `GET /api/usage` returns 404 (server without billing routes), then the panel is hidden and the rest of the UI works unchanged.
- Given a budgeted account, then the `max-acu` input is marked required and the Launch button is disabled while it is empty.

**Technical notes**
- Touches: `web/index.html` (panel + `max-acu` `required`), `web/app.js` (fetch `/api/usage` alongside the sessions poll; render 402 details), `web/styles.css`.
- Manual check with screenshot; no UI test harness exists in the repo.

**Out of scope**
- Statement/admin views in the UI.

---

## Traceability matrix

| Requirement | Stories |
|-------------|---------|
| R1 | STORY-1 |
| R2 | STORY-1 |
| R3 | STORY-1 |
| R4 | STORY-2, SPIKE-1 |
| R5 | STORY-3 |
| R6 | STORY-1 (session scoping), STORY-4 |
| R7 | STORY-5 |
| R8 | STORY-6 |
| R9 | STORY-7 |
| R10 | STORY-4 |
| R11 | STORY-1, STORY-2, STORY-3 |
| R12 | STORY-4, STORY-6 |

Every requirement is covered; every story traces to at least one requirement.

## Flagged for refinement

- STORY-2 cannot be finalised until SPIKE-1 answers Q1; if the ACU field is
  absent, STORY-2 shrinks to status tracking (2 pts) and STORY-5 bills
  `maxAcuLimit` ceilings.
- STORY-1 is at the "large" limit (8). If it slips, split the `tokenEnv` /
  compaction / truncated-line handling into a follow-up (3 pts) and keep the
  attribution + replay path in the skeleton.
