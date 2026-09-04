---
name: spec-to-stories
description: Decompose a PRD or tech spec into an epic with INVEST user stories, each with Gherkin acceptance criteria, requirement traceability, and a size estimate. Use when asked to break down a spec, create a backlog, or turn requirements into tickets.
metadata:
  stage: stories
  tags: [stories, backlog, epic, decomposition, gherkin]
  inputs: [spec document with requirement IDs, target repo(s), team conventions for story format]
  outputs: ["stories.md (or JSON) with one entry per story, ready for create-tickets"]
  next: [sdlc-stories:story-refinement, sdlc-stories:create-tickets]
---

# Spec → stories

Available as `/sdlc-stories:spec-to-stories`.

## Steps

1. Read the spec end to end. List every requirement ID and acceptance
   criterion. If IDs are missing, assign them (`R1`, `R1-AC1`) and note it.
2. Read the relevant code so stories are sliced along real seams (module,
   endpoint, table, screen) — not along the spec's paragraph structure.
3. Slice vertically: each story delivers observable user value and is
   independently mergeable behind a flag if needed. Avoid layer stories
   ("build the DB schema", "build the API", "build the UI") unless a layer is
   genuinely reusable on its own.
4. For each story fill the template below. Every story must trace to at least
   one requirement ID; every requirement must be covered by at least one
   story. Produce the traceability matrix at the end.
5. Order stories by dependency, then by risk (riskiest first). Mark the
   walking-skeleton story that proves the end-to-end path.
6. Estimate with the team's scale (points or T-shirt). Split anything larger
   than the team's "large".
7. Write the epic summary: goal, stories in order, out-of-scope list copied
   from the spec's non-goals.

## Story template

```markdown
### <STORY-N>: <Verb phrase, user-visible outcome>
**As a** <role> **I want** <capability> **so that** <benefit>.

**Traces to:** R2, R5
**Depends on:** STORY-1
**Estimate:** 3

**Acceptance criteria**
- Given <context>, when <action>, then <observable result>.
- Given ..., when ..., then ...

**Technical notes**
- Touches: `src/orders/service.ts`, `migrations/`
- Flag: `orders.split_payments`

**Out of scope**
- ...
```

## INVEST check (apply to every story)

- **Independent** — can merge without waiting on a sibling (dependencies are
  ordering, not blocking).
- **Negotiable** — describes the outcome, not the implementation.
- **Valuable** — a user or operator notices when it ships.
- **Estimable** — the team can size it without a spike; if not, add a spike
  story with a time box.
- **Small** — fits in a few days.
- **Testable** — every AC is verifiable by a test or a manual check.

## Output

- `stories.md` (or JSON when a tool will consume it) containing the epic
  summary, ordered stories, and the traceability matrix
  (`requirement → stories`).

## Hand-off

Run `/sdlc-stories:story-refinement` on anything flagged as unclear, then
`/sdlc-stories:create-tickets` to push into the tracker.
