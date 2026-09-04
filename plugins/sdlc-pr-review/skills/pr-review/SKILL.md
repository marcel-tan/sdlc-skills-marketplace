---
name: pr-review
description: Review a pull request or diff for correctness, safety, test adequacy, and style, reporting findings grouped by severity with file:line references and traceability to the story's acceptance criteria. Use when asked to review a PR, branch, or diff.
metadata:
  stage: pr-review
  tags: [code-review, pull-request, quality]
  inputs: [PR URL/number or branch name, linked ticket (optional)]
  outputs: [review posted on the PR (or returned as text) with blocker/should-fix/nit findings and an explicit verdict]
  next: [sdlc-pr-review:address-review-feedback, sdlc-pr-review:security-review]
---

# PR review

Available as `/sdlc-pr-review:pr-review`.

## Steps

1. Read the PR description and the linked ticket/spec. Write down the
   acceptance criteria the PR claims to satisfy.
2. Get the full change set (`git diff --merge-base <base>` or the PR diff).
   Read every changed file **in full**, not just the hunks — most review
   misses come from unseen context.
3. Check CI status and, if it is red, read the failing job before reviewing
   code.
4. Review in order of severity, recording each finding as
   `severity | file:line | what | why | suggested fix`:

   **Correctness**
   - Does each AC have code *and* a test that would fail without it?
   - Logic errors, off-by-one, null/undefined paths, error handling that
     swallows or mis-maps failures, concurrency and ordering assumptions.
   - Behavior changes not mentioned in the description.

   **Safety**
   - Secrets or credentials in code/config/tests.
   - Input validation at trust boundaries; injection (SQL, shell, template).
   - Authn/authz checks match neighboring code; no privilege widening.
   - Data migrations: reversible, backfilled, safe under load.
   - New dependencies: necessary, maintained, license-compatible.

   **Tests**
   - Tests assert behavior rather than implementation.
   - Existing tests were not weakened or deleted to pass.
   - Flake risks (sleeps, shared state, real network).

   **Maintainability / style**
   - Consistent with surrounding code; naming; dead code; duplicated logic
     that should reuse an existing helper.
   - Comments explain *why*, not the diff.

5. Decide the verdict: **Approve**, **Approve with nits**, or **Request
   changes** (any blocker). Be explicit.
6. Post the review. Use inline comments for file-specific findings and a
   summary comment using the template. Praise something specific if it is
   genuinely good — it calibrates the criticism.

## Summary template

```markdown
## Review: <PR title>
**Verdict:** Request changes

### Blockers
- `src/orders/service.ts:142` — total ignores refunds; AC3 requires net total. Add a test with a refunded line item.

### Should fix
- ...

### Nits
- ...

### AC coverage
| AC | Code | Test |
|----|------|------|
| AC1 | yes | `orders.spec.ts::splits totals` |
| AC3 | partial | missing |

### Clean
Safety, Style
```

## Hand-off

Author runs `/sdlc-pr-review:address-review-feedback`. For PRs touching auth,
payments, PII, or infrastructure, also run `/sdlc-pr-review:security-review`.
