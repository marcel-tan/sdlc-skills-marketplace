# Usage-based billing for Devin sessions launched through the MCP server

**Status:** Draft | **Owner:** marcel-tan | **Last updated:** 2026-09-04

## Problem

The HTTP mode of `sdlc-skills-mcp` lets any caller holding the single shared
`MCP_AUTH_TOKEN` start Devin sessions (`POST /api/sessions` in
`mcp-server/src/api.ts`, `start_devin_session` in `mcp-server/src/server.ts`).
Every launch spends the operator's Devin credits (ACUs) against one
`DEVIN_API_KEY`, but nothing records *who* launched *what* or *how much it
cost*: `LaunchedSession` is an in-memory array capped at 200 entries and lost on
restart, there is one bearer token for all callers, and the only cost control
is the optional, caller-chosen `maxAcuLimit`. Teams that share a deployed
instance cannot attribute spend, enforce a budget, or charge back to a cost
center, so today they either run one instance per team or reconcile by hand
from the Devin usage dashboard.

## Goals

- G1 Attribute every session launched through the server to a billable account
  and record its ACU consumption durably.
- G2 Let operators define per-account rate plans (price per ACU plus an
  optional included allowance) and produce a monthly usage statement per
  account.
- G3 Enforce a hard monthly ACU budget per account at launch time so a runaway
  team cannot exhaust the shared Devin credits.
- G4 Expose usage to callers (API and launcher UI) so they can see their own
  consumption before their statement arrives.

## Non-goals

- NG1 Collecting payment (card processing, Stripe/Chargebee integration, tax).
  Statements are informational; settlement happens outside this system.
- NG2 Billing for anything other than Devin sessions launched through this
  server (no charge for `recommend_skills`, `compose_session_prompt`,
  `/api/skills`, or stdio-mode usage).
- NG3 Replacing Devin's own org-level ACU accounting; the Devin usage
  dashboard remains the source of truth for what Devin charges the operator.
- NG4 Multi-currency, proration of mid-cycle plan changes, credits/refunds,
  and discounts beyond a flat included allowance.
- NG5 A self-service signup flow. Accounts and API keys are created by the
  operator via CLI/env configuration.
- NG6 Per-user attribution inside an account (the v3 `create_as_user_id`
  field is passed through unchanged but not billed separately).

## Users

- **Operator** — runs a deployed `sdlc-skills-mcp --http --host 0.0.0.0`
  instance for several teams and pays the Devin bill. Today reconciles cost
  from the Devin dashboard by title/tag guessing.
- **Team lead / caller** — launches sessions via the launcher UI or an MCP
  client. Today has no visibility into what their team has spent.

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | Every `POST /api/sessions` and `start_devin_session` call that creates a Devin session is attributed to exactly one **account** identified by the presented bearer token. The single `MCP_AUTH_TOKEN` continues to work and maps to a built-in account `default`. | P0 |
| R2 | Operators can configure multiple accounts, each with its own bearer token, display name, rate plan, and monthly ACU budget, via a JSON file whose path is given by `BILLING_CONFIG` (schema in Technical approach). Invalid config fails startup with a message naming the field. | P0 |
| R3 | Each launched session is persisted as a **usage record** (`accountId`, `sessionId`, `launchedAt`, `skillIds`, `maxAcuLimit`, `acuUsed`, `status`) in an append-only JSON-lines file at `BILLING_DATA_DIR`. Records survive process restart. | P0 |
| R4 | `acuUsed` is refreshed from the Devin API for every non-final session at least every 5 minutes and on each `GET /api/sessions/:id`, until the session reaches state `finished` or `error`, after which it is frozen. | P0 |
| R5 | A launch is rejected with HTTP 402 / MCP error when the account's **committed ACU** for the current UTC calendar month plus the requested `maxAcuLimit` would exceed its `monthlyAcuBudget`. Committed ACU = sum of `acuUsed` for final sessions + sum of `maxAcuLimit` for non-final sessions + outstanding reservations. The 402 body includes `resetsAt` (first instant of the next UTC month). Launches without `maxAcuLimit` are rejected with HTTP 400 for accounts that have a budget. Accounts with no budget are never rejected by this rule. | P0 |
| R6 | `GET /api/usage` returns the calling account's current-month totals (`acuUsed`, `sessionCount`, `budget`, `remaining`) and `GET /api/usage/sessions` lists its usage records for the month, newest first, with `?month=YYYY-MM` to select another month. Accounts only ever see their own data; `GET /api/sessions` and `GET /api/sessions/:id` are likewise scoped to the calling account (404 for another account's session). | P0 |
| R7 | `GET /api/billing/statement?month=YYYY-MM` returns the calling account's statement: `acuUsed`, `includedAcu`, `billableAcu = max(0, acuUsed - includedAcu)`, `pricePerAcu`, `amount = billableAcu * pricePerAcu` rounded half-up to 2 decimals, `currency`, and the list of sessions. | P1 |
| R8 | An **admin** account flag lets the operator call `GET /api/admin/usage?month=` to list every account's totals and statement in one response, and `GET /api/admin/usage.csv` for the same as CSV. Non-admin accounts get 403. | P1 |
| R9 | The launcher UI (`web/`) shows the signed-in account's month-to-date ACU, budget, and remaining ACU next to the session list, and shows the 402 budget error inline on launch. | P1 |
| R10 | A new MCP tool `get_usage` returns the same payload as R6 for the calling account, so agents can check remaining budget before launching. | P2 |
| R11 | Every rejected launch (R5) and every usage refresh failure (R4) is logged to stderr with `accountId`, `sessionId` where applicable, and the reason, without logging bearer tokens or the Devin API key. | P0 |
| R12 | All new routes and the tool respond in p95 < 200 ms for accounts with up to 10,000 usage records in the month, measured locally on the vitest suite fixtures. | P1 |

## Acceptance criteria

- **R1-AC1** Given HTTP mode with only `MCP_AUTH_TOKEN` set, when a caller
  launches a session with that token, then the usage record has
  `accountId: "default"`.
- **R1-AC2** Given two accounts `alpha` and `beta` configured, when a session
  is launched with `beta`'s token, then the usage record has
  `accountId: "beta"` and `GET /api/usage` with `alpha`'s token does not
  include it.
- **R1-AC3** Given accounts are configured, when a request presents a token
  matching no account, then the response is 401 with `WWW-Authenticate:
  Bearer` (unchanged from today).
- **R1-AC4** Given accounts are configured and a client calls the
  `start_devin_session` MCP tool over `/mcp`, then the resulting usage record
  is attributed to the account whose token was on that HTTP request.
- **R2-AC1** Given `BILLING_CONFIG` points to a file with two accounts, when
  the server starts, then stderr logs `loaded 2 billing accounts` and both
  tokens authenticate.
- **R2-AC2** Given `BILLING_CONFIG` has an account missing `token`, when the
  server starts, then it exits non-zero with a message containing
  `accounts[1].token`.
- **R2-AC3** Given both `BILLING_CONFIG` and `MCP_AUTH_TOKEN` are set, when
  the server starts, then `MCP_AUTH_TOKEN` authenticates as `default` in
  addition to the configured accounts.
- **R2-AC4** Given two accounts share the same token value, when the server
  starts, then it exits non-zero naming the duplicate.
- **R3-AC1** Given a session was launched, when the process is restarted with
  the same `BILLING_DATA_DIR`, then `GET /api/usage/sessions` still lists it.
- **R3-AC2** Given `BILLING_DATA_DIR` is not writable, when the server starts
  in HTTP mode, then it exits non-zero naming the directory.
- **R3-AC3** Given `BILLING_DATA_DIR` is unset, when the server starts (with
  or without `BILLING_CONFIG`), then billing runs in memory only and stderr
  logs `BILLING_DATA_DIR not set; usage records are not persisted`.
- **R3-AC4** Given `usage.jsonl` ends with a truncated line, when the server
  starts, then the remaining records load, one warning is logged, and the
  server serves requests.
- **R4-AC1** Given a launched session that Devin reports as `running` with
  `acu_used: 3.5`, when 5 minutes elapse, then `GET /api/usage/sessions`
  shows `acuUsed: 3.5` for it.
- **R4-AC2** Given a session that reached `finished` with `acuUsed: 7`, when
  the Devin API later returns a different value, then the record still shows
  `7` and no further refresh calls are made for that session.
- **R4-AC3** Given the Devin API returns 5xx during a refresh, when the
  refresh runs, then the previous `acuUsed` is retained, the failure is logged
  (R11), and the next scheduled refresh still happens.
- **R5-AC1** Given account `alpha` with `monthlyAcuBudget: 100` and 95 ACU
  committed this month, when it launches with `maxAcuLimit: 10`, then the
  response is 402 with body `{ error, accountId, budget: 100, committed: 95,
  requested: 10, resetsAt }` and no Devin API call is made.
- **R5-AC7** Given a running session with `maxAcuLimit: 20` that has so far
  used 2 ACU, when the budget check runs, then it counts 20 (not 2) toward
  committed ACU.
- **R5-AC2** Given the same account, when it launches with `maxAcuLimit: 5`,
  then the session is created (201).
- **R5-AC3** Given an account with a budget, when it launches without
  `maxAcuLimit`, then the response is 400 and the message says
  `maxAcuLimit is required for budgeted accounts`.
- **R5-AC4** Given an account with no `monthlyAcuBudget`, when it launches
  without `maxAcuLimit`, then the session is created.
- **R5-AC5** Given `dryRun: true`, when the launch would exceed the budget,
  then the response is 200 with `dryRun: true` and an additional
  `budgetCheck: { ok: false, ... }` field; nothing is recorded.
- **R5-AC6** Given two concurrent launches from the same account that each
  individually fit but together exceed the budget, when both are processed,
  then at most one succeeds (reservation is applied before the Devin call).
- **R6-AC1** Given account `alpha` launched 3 sessions this month totalling
  12.5 ACU against a budget of 100, when it calls `GET /api/usage`, then the
  body is `{ accountId: "alpha", month: "<YYYY-MM>", acuUsed: 12.5,
  sessionCount: 3, budget: 100, remaining: 87.5 }`.
- **R6-AC2** Given no sessions this month, when `GET /api/usage` is called,
  then `acuUsed: 0, sessionCount: 0, remaining: budget` (or `remaining:
  null` and `budget: null` when there is no budget).
- **R6-AC3** Given `?month=2026-13`, when `GET /api/usage/sessions` is
  called, then the response is 400.
- **R6-AC4** Given a session launched by `beta`, when `alpha` calls
  `GET /api/sessions/<id>`, then the response is 404.
- **R7-AC1** Given a plan `{ pricePerAcu: 2.5, includedAcu: 10, currency:
  "USD" }` and 12.5 ACU used, when the statement is requested, then
  `billableAcu: 2.5` and `amount: 6.25`.
- **R7-AC4** Given `pricePerAcu: 0.333` and `billableAcu: 1`, then
  `amount: 0.33`.
- **R7-AC5** Given a session that is still `running` in the requested month,
  then the statement includes it with `status: "running"` and a top-level
  `final: false`; statements for a month with no non-final sessions return
  `final: true`.
- **R7-AC2** Given 8 ACU used against `includedAcu: 10`, then
  `billableAcu: 0` and `amount: 0`.
- **R7-AC3** Given an account with no `plan`, then the statement returns
  `plan: null`, `amount: null`, and the usage fields.
- **R8-AC1** Given an account with `admin: true`, when it calls
  `GET /api/admin/usage?month=2026-08`, then the body lists every account's
  statement for that month, including accounts with zero usage.
- **R8-AC2** Given a non-admin account, when it calls any `/api/admin/*`
  route, then the response is 403.
- **R8-AC4** Given `BILLING_CONFIG` has no account with `admin: true`, when
  the server starts, then it logs `no admin account configured; /api/admin
  routes are disabled` and those routes return 404 for everyone.
- **R8-AC3** Given `GET /api/admin/usage.csv`, then the response has
  `content-type: text/csv` and one row per account with columns `accountId,
  month, acuUsed, includedAcu, billableAcu, pricePerAcu, amount, currency`.
- **R9-AC1** Given the launcher UI is loaded with a valid token, then a
  "Usage this month" panel shows `acuUsed / budget` and `remaining`, refreshed
  on the existing 15 s poll.
- **R9-AC2** Given a launch returns 402, then the error is shown inline under
  the Launch button with the budget figures from the response body.
- **R10-AC1** Given an MCP client calls `get_usage` over `/mcp` with
  `alpha`'s token, then the tool result is the R6 payload for `alpha`.
- **R10-AC2** Given stdio mode, when `get_usage` is called, then it returns
  the `default` account's in-memory totals for the current process.
- **R11-AC1** Given a launch is rejected under R5, then a single stderr line
  contains `budget exceeded`, the `accountId`, and the numbers, and does not
  contain the bearer token.
- **R12-AC1** Given 10,000 usage records for one account in the month, when
  `GET /api/usage` is called, then p95 latency across 100 requests in the
  test is under 200 ms.

## Technical approach

Smallest design that meets R1–R12: one new module, one auth change, a
background refresher, and additive routes/tools. No database — a JSON config
file plus a JSON-lines ledger, matching the zero-infra shape of the existing
server.

### Touched components

- `mcp-server/src/billing.ts` (new) — account registry, ledger, budget check,
  statement math. Pure functions over an in-memory index; the ledger file is
  the durable log.
- `mcp-server/src/bin.ts` — replace `bearerMatches(req, token)` with
  `resolveAccount(req)` that returns an `Account | undefined` (constant-time
  comparison per account, as today). Pass the account into the API handler
  and the per-request MCP server (`createServer({ catalog, devin, account })`).
- `mcp-server/src/api.ts` — thread `account` through `route()`; on
  `POST /api/sessions` call `billing.reserve()` before `createDevinSession`,
  `billing.record()` after; add `/api/usage`, `/api/usage/sessions`,
  `/api/billing/statement`, `/api/admin/usage`, `/api/admin/usage.csv`.
  `GET /api/sessions` becomes account-scoped (a caller sees only its own
  launches); the in-memory `launched` array is replaced by the ledger.
- `mcp-server/src/server.ts` — `start_devin_session` calls the same
  `reserve`/`record`; new `get_usage` tool.
- `mcp-server/src/devin.ts` — `SessionStatus` gains `acuUsed: number | null`
  read from the session response. **Assumption:** the Devin session object
  exposes ACU consumption (`acu_used` or similar); confirm the exact field
  name for v1 and v3 (Open question 1).
- `web/app.js`, `web/index.html` — usage panel and 402 rendering.
- `README.md` — document `BILLING_CONFIG`, `BILLING_DATA_DIR`, new routes.

### Data

`BILLING_CONFIG` (JSON):

```json
{
  "accounts": [
    {
      "id": "alpha",
      "name": "Platform team",
      "token": "…",
      "admin": false,
      "monthlyAcuBudget": 100,
      "plan": { "pricePerAcu": 2.5, "includedAcu": 10, "currency": "USD" }
    }
  ]
}
```

Validated with a zod schema at startup. `id` matches `^[a-z0-9-]{1,64}$` and
is unique; `token` is unique and at least 16 characters; `monthlyAcuBudget`
and `plan` are optional. Tokens may alternatively be given as `tokenEnv:
"ALPHA_TOKEN"` so the file itself contains no secrets.

`BILLING_DATA_DIR/usage.jsonl` — one JSON object per line:

```json
{"accountId":"alpha","sessionId":"devin-…","launchedAt":"2026-09-04T07:00:00Z","skillIds":["sdlc-specs:write-prd"],"maxAcuLimit":10,"acuUsed":3.5,"status":"running","updatedAt":"2026-09-04T07:05:00Z"}
```

Updates append a new line for the same `sessionId`; the latest line wins when
the file is replayed at startup. The file is compacted (rewritten with only
the latest line per session) when it exceeds 50 MB.

No migration is needed: the ledger starts empty and the pre-billing
`launched` array was never persisted.

### Budget enforcement

`reserve(accountId, maxAcuLimit)` runs synchronously against the in-memory
index (Node is single-threaded, so two concurrent requests cannot interleave
inside it) and adds `maxAcuLimit` to a `reserved` counter for the account.
After `createDevinSession` returns, `record()` converts the reservation into a
usage record; on failure the reservation is released. The budget check is
`acuUsed(month) + reserved + maxAcuLimit <= monthlyAcuBudget`. Because
`acuUsed` for running sessions can only grow up to `maxAcuLimit`, the sum of
`maxAcuLimit` for running sessions is used in place of their current
`acuUsed` when checking, so the budget is a true ceiling.

### Refresh loop

A `setInterval` (5 min, unref'd) iterates non-final records and calls
`getDevinSession`. Errors are logged and skipped. The loop only runs in HTTP
mode with `DEVIN_API_KEY` set.

### Alternatives considered

- **SQLite via `node:sqlite`** — cleaner queries and compaction for free, but
  `node:sqlite` is experimental below Node 22.5 and the repo supports Node 20;
  adding `better-sqlite3` brings a native dependency to an `npx`-installable
  package. Revisit if the JSONL ledger exceeds tens of thousands of records.
- **Bill on Devin's usage export instead of polling** — accurate but the
  export is org-wide and not queryable per session from the API today;
  polling per session is what the server already does for status.
- **Per-account `DEVIN_API_KEY`** — pushes attribution to Devin itself, but
  requires each team to hold a Devin service-user key, which is the
  shared-instance problem this feature exists to avoid.
- **Bill per session instead of per ACU** — trivially meterable but does not
  track cost; kept as an optional future plan type.

### Risks & mitigations

- *ACU field not available or lagging in the session API* — `acuUsed` stays
  `null`, budget enforcement falls back to `maxAcuLimit` ceilings (already
  what the design uses), statements show `acuUsed` as "pending" for those
  sessions. Confirm before implementation (Open question 1).
- *Ledger corruption on crash mid-write* — each line is written with a single
  `appendFile` call; a truncated last line is skipped on replay with a warning.
- *Token file leaks* — support `tokenEnv` indirection; README warns not to
  commit the config; tokens are never logged (R11).
- *Budget rejects legitimate work at month boundary* — budget is per UTC
  calendar month; the 402 body tells the caller when the budget resets
  (`resetsAt`).
- *Behavioral change to `GET /api/sessions`* — becomes account-scoped. Under
  the single-token default there is only one account, so existing deployments
  see no difference.

## Rollout

- Feature is inert unless `BILLING_CONFIG` or `BILLING_DATA_DIR` is set; with
  neither set the server behaves as today plus an in-memory `default` account
  (no persistence, no budget). No flag needed beyond these env vars.
- Stage 1 (R1–R4, R11): attribution and ledger; deploy with
  `BILLING_DATA_DIR` only and verify `usage.jsonl` matches the Devin
  dashboard for a week.
- Stage 2 (R5, R6, R10): budgets and usage routes; start with budgets set 2×
  above observed usage.
- Stage 3 (R7–R9, R12): statements, admin view, UI.
- Monitoring: stderr lines `budget exceeded`, `usage refresh failed`, and a
  `billing` block in `/healthz` (`accounts`, `records`, `lastRefreshAt`).
- Rollback: unset the env vars and restart; the ledger file is left in place
  and can be re-read later.

## Open questions

- [ ] Q1 Which field on the Devin v1/v3 session response carries ACU
  consumption, and how quickly does it update? **Assumption:** a numeric
  `acu_used` exists on both; if it does not, R4 degrades to `maxAcuLimit`
  ceilings and statements bill the ceiling until confirmed.
- [ ] Q2 Should the `default` account be allowed a budget via env
  (`MCP_DEFAULT_ACU_BUDGET`)? **Assumption:** no; budgets require
  `BILLING_CONFIG`.
- [ ] Q3 Is UTC calendar month acceptable as the billing period for all
  operators? **Assumption:** yes for v1 (NG4 excludes custom cycles).
- [ ] Q4 Does any operator need the statement to include sessions launched
  outside this server (directly in Devin)? **Assumption:** no (NG3).
