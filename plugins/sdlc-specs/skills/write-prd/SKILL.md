---
name: write-prd
description: Turn a problem statement, feature request, or ticket into a PRD / tech spec with goals, non-goals, requirements, and testable acceptance criteria. Use when asked to write a spec, PRD, RFC, or design doc for new work.
metadata:
  stage: specs
  tags: [prd, spec, rfc, requirements, design-doc]
  inputs: [problem statement or feature request, known constraints, target repo(s)]
  outputs: ["docs/specs/<slug>.md committed on a branch, or a Confluence/Notion page if the org keeps specs there"]
  next: [sdlc-specs:spec-review, sdlc-stories:spec-to-stories]
---

# Write a PRD / tech spec

Available as `/sdlc-specs:write-prd`.

## Inputs to collect first

- The problem statement (verbatim from the user, ticket, or Slack thread).
- Who the users are and what they do today (the workaround).
- Hard constraints: deadlines, compliance, platforms, budgets, existing systems
  that must not change.
- Where specs live in this org (`docs/`, `rfcs/`, Confluence, Notion). Match
  the existing location and template if one exists; look before creating.

If any of these are unknown, make one explicit assumption per gap and list it
in the **Open questions** section rather than blocking.

## Steps

1. Read the codebase areas the feature touches (search for the relevant
   modules, APIs, data models). Cite concrete file paths in the spec.
2. Draft the document using the template below. Every requirement gets a
   stable ID (`R1`, `R2`, ...) so stories and tests can reference it.
3. Write acceptance criteria as observable behaviors (Given/When/Then), not
   implementation notes. Each requirement needs at least one.
4. Enumerate non-goals explicitly — this is what keeps scope from creeping
   during story creation.
5. Add a short **Technical approach** with the smallest design that meets
   the requirements, alternatives considered, and risks.
6. Save to the org's spec location on a new branch and open a PR (or create
   the page) so the spec is reviewable.

## Template

```markdown
# <Title>

**Status:** Draft | **Owner:** <name> | **Last updated:** <date>

## Problem
<2–4 sentences: who is affected, what hurts, evidence>

## Goals
- G1 ...

## Non-goals
- NG1 ...

## Requirements
| ID | Requirement | Priority (P0/P1/P2) |
|----|-------------|---------------------|
| R1 | ... | P0 |

## Acceptance criteria
- **R1-AC1** Given ..., when ..., then ...

## Technical approach
<smallest viable design; touched components with file paths; data changes; API changes>

### Alternatives considered
- ...

### Risks & mitigations
- ...

## Rollout
<flags, migrations, monitoring, rollback>

## Open questions
- [ ] ...
```

## Quality bar

- Someone who has never seen the conversation can build from this document.
- No requirement is untestable ("should be fast" → "p95 < 300 ms at 100 rps").
- Non-goals section is non-empty.

## Hand-off

Run `/sdlc-specs:spec-review` on the draft, then `/sdlc-stories:spec-to-stories`
to break it into tickets. Reference requirement IDs in every story.
