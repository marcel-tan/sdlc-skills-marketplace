---
name: spec-review
description: Review an existing PRD, RFC, or tech spec for ambiguity, missing requirements, untestable acceptance criteria, and unstated risks. Use when asked to review, critique, or sanity-check a spec or design doc before implementation starts.
metadata:
  stage: specs
  tags: [spec, review, requirements, risk]
  inputs: [spec document (path, URL, or pasted text), target repo(s)]
  outputs: [review comments on the spec PR/page, or a findings list grouped by severity]
  next: [sdlc-stories:spec-to-stories]
---

# Spec review

Available as `/sdlc-specs:spec-review`.

## Steps

1. Read the whole spec once without taking notes. Then read the parts of the
   codebase it claims to touch — verify the spec's assumptions about current
   behavior against the actual code.
2. Check each category below and record findings with a severity:
   - **Blocker** — implementation cannot start (contradiction, missing P0
     requirement, undefined behavior at a trust boundary).
   - **Should-fix** — will cause rework or scope disputes later.
   - **Nit** — wording, structure.
3. Post findings where the spec lives (PR review comments, page comments) or
   return them as a list. Quote the exact sentence you are reacting to.
4. State explicitly which categories are clean.

## Review checklist

**Completeness**
- Every goal maps to at least one requirement; every requirement has at least
  one acceptance criterion.
- Error paths, empty states, concurrency, and permission cases are covered.
- Non-goals section exists and rules out the obvious adjacent scope.

**Testability**
- Each acceptance criterion is observable from the outside (API response, UI
  state, log/metric) — not "the service should handle X correctly".
- Performance/scale requirements have numbers.

**Consistency with reality**
- Referenced modules, tables, endpoints exist (cite file paths). Flag where
  the spec describes current behavior incorrectly.
- Data model changes list migrations and backfills.

**Risk**
- Rollout/rollback plan exists for anything user-visible.
- Security: authn/authz, PII handling, secrets, input validation at boundaries.
- Dependencies on other teams/systems are named with an owner.

**Clarity**
- No "etc.", "and so on", "as appropriate", or undefined acronyms.
- Requirement IDs are stable and unique.

## Output format

```
## Spec review: <title>

### Blockers
- [R3] "<quoted sentence>" — <why it blocks> — <suggested fix>

### Should fix
- ...

### Nits
- ...

### Clean
Completeness, Risk
```

## Hand-off

Once blockers are resolved, run `/sdlc-stories:spec-to-stories`.
