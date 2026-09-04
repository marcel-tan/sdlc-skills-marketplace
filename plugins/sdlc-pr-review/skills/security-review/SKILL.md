---
name: security-review
description: Perform a security-focused review of a PR or module against OWASP Top 10 and the repo's threat model - authn/authz, input validation, injection, secrets, data exposure, dependency risk, and infrastructure changes. Use when a change touches authentication, payments, PII, permissions, crypto, file/network I/O, IaC, or when asked for a security review.
metadata:
  stage: pr-review
  tags: [security, owasp, secrets, authz, dependencies, iac]
  inputs: [PR URL/number or module path, threat model or data classification (optional)]
  outputs: [security findings with severity (critical/high/medium/low), CWE/OWASP references, and concrete remediation; verdict]
  next: [sdlc-pr-review:address-review-feedback]
---

# Security review

Available as `/sdlc-pr-review:security-review`.

## Steps

1. Identify the trust boundaries the change crosses: user input → server,
   service → service, service → datastore, CI → cloud, code → third-party
   dependency. Every finding should be anchored to a boundary.
2. Run the repo's existing scanners first (SAST, dependency audit, secret
   scan, IaC lint — e.g. `npm audit`, `pip-audit`, `gitleaks`, `semgrep`,
   `trivy`, `checkov`, `tfsec`, `conftest`). Report their results; do not
   duplicate what they already caught.
3. Manually review against the checklist below, reading the full changed
   files plus the callers/callees of any touched security-relevant function.
4. Rate each finding: **Critical** (exploitable now, high impact), **High**,
   **Medium**, **Low**/informational. Include CWE or OWASP category and a
   concrete fix, ideally as a code suggestion.
5. Verdict: block on any Critical/High. Post findings on the PR; for anything
   Critical in already-deployed code, notify the owner privately rather than
   in a public comment.

## Checklist

**Access control (A01)** — every new endpoint/handler enforces authn and
object-level authz; no IDs trusted from the client without ownership checks;
admin paths gated.

**Cryptography (A02)** — no custom crypto; approved algorithms and modes;
keys from a secret manager, not code; TLS not disabled; hashes for passwords
use a slow KDF.

**Injection (A03)** — parameterized queries; no shell string interpolation;
template auto-escaping on; path traversal guarded; deserialization of
untrusted data avoided.

**Design & config (A04/A05)** — safe defaults; debug/verbose modes off in
prod; CORS/CSP/headers unchanged or tightened; rate limiting on new public
endpoints; error messages do not leak internals.

**Dependencies (A06)** — new deps are necessary, actively maintained,
pinned; lockfile updated; no known CVEs; install scripts reviewed.

**Identity (A07)** — session handling, token expiry, MFA paths not weakened;
password reset and email-change flows re-authenticate.

**Integrity (A08)** — CI/CD changes reviewed for untrusted inputs
(`pull_request_target`, script injection via branch names); artifacts
signed/verified where the pipeline already does so.

**Logging (A09)** — security events logged; no secrets/PII in logs; log
injection guarded.

**SSRF & outbound (A10)** — user-controlled URLs validated against an
allowlist; internal metadata endpoints blocked.

**Secrets & data** — no credentials in code, tests, fixtures, or history;
PII fields classified and encrypted/masked per policy; data retention
respected.

**Infrastructure as code** — least-privilege IAM; no `0.0.0.0/0` ingress
without justification; encryption at rest; public buckets/blobs denied;
state/backends locked.

## Finding template

```markdown
### [High] IDOR on GET /orders/{id} — CWE-639 / A01
`src/api/orders.ts:88` loads the order by id without checking `order.userId === session.userId`.
**Fix:** scope the query by the authenticated user; add a test that a second user receives 404.
```

## Hand-off

Author runs `/sdlc-pr-review:address-review-feedback`.
