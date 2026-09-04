---
name: adr
description: Write an Architecture Decision Record capturing context, options considered, the decision, and consequences. Use when a spec or discussion involves choosing between technical approaches (library, storage, protocol, service boundary) that future engineers will need to understand.
metadata:
  stage: specs
  tags: [adr, architecture, decision]
  inputs: [decision to be made, options under consideration, constraints]
  outputs: ["docs/adr/NNNN-<slug>.md on a branch with a PR"]
  next: [sdlc-stories:spec-to-stories, sdlc-codegen:implement-story]
---

# Architecture Decision Record

Available as `/sdlc-specs:adr`.

## Steps

1. Locate the org's ADR directory (`docs/adr/`, `adr/`, `docs/decisions/`).
   If none exists, create `docs/adr/` and use the next sequential number
   (`0001`). Match an existing template if present.
2. Gather evidence for each option: read the relevant code, check what the
   repo already depends on, and check license/maintenance status of any new
   dependency (last release date, open issues, bus factor).
3. Write the ADR using the template. Be honest about trade-offs — an ADR
   whose rejected options have no upsides is not credible.
4. Set status to **Proposed**; the reviewer flips it to **Accepted**. Never
   edit an accepted ADR's decision — supersede it with a new one.
5. Open a PR with the ADR alone (no implementation in the same PR).

## Template

```markdown
# ADR-NNNN: <Decision title, as a statement>

**Status:** Proposed | Accepted | Superseded by ADR-MMMM
**Date:** YYYY-MM-DD
**Deciders:** <names>

## Context
<What forces are at play: requirements (link spec IDs), constraints, current state with file paths>

## Options considered

### Option A — <name>
- Pros:
- Cons:
- Cost/effort:

### Option B — <name>
...

## Decision
<Which option and the one-paragraph reason>

## Consequences
- Positive:
- Negative / what we accept:
- Follow-ups: <migrations, deprecations, docs>
```

## Quality bar

- At least two real options; "do nothing" counts if it is genuinely viable.
- The decision references requirement IDs from the spec where applicable.
- Consequences include at least one negative.

## Hand-off

Link the ADR from the spec, then continue with `/sdlc-stories:spec-to-stories`
or, if stories exist, `/sdlc-codegen:implement-story`.
