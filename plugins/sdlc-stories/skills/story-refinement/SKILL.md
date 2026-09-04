---
name: story-refinement
description: Tighten an existing story or ticket so it is ready for implementation - sharpen acceptance criteria, surface hidden dependencies and edge cases, right-size the estimate, and add technical notes with file paths. Use when a ticket is vague, too large, or fails the definition of ready.
metadata:
  stage: stories
  tags: [refinement, grooming, acceptance-criteria, definition-of-ready]
  inputs: [ticket ID or story text, target repo(s)]
  outputs: [updated ticket description (or proposed diff of it), split tickets if needed]
  next: [sdlc-codegen:implement-story]
---

# Story refinement

Available as `/sdlc-stories:story-refinement`.

## Definition of ready

A story is ready when all of these hold:

1. Outcome is stated from the user's or operator's perspective.
2. Every acceptance criterion is Given/When/Then and observable.
3. Edge cases are enumerated: empty, max, concurrent, unauthorized, failure of
   each external dependency.
4. Dependencies (other tickets, teams, flags, data) are listed with status.
5. Technical notes point at concrete files/modules and any migration.
6. It fits the team's size limit; otherwise it is split.
7. Test approach is named (unit / integration / e2e) per AC.

## Steps

1. Fetch the ticket (use the tracker MCP if available — Jira, Linear, Azure
   Boards, GitHub Issues) and its parent spec.
2. Read the code the story touches. Confirm the story's assumptions; note
   where the code disagrees with the ticket.
3. Rewrite the story to satisfy the definition of ready. Keep the original
   intent; do not add scope. Put anything you cut into **Out of scope** so
   nothing is silently dropped.
4. If the story must be split, create N stories that each pass INVEST and
   keep the traceability to requirement IDs. Name the first one that
   delivers end-to-end value.
5. Propose the estimate change with a one-line reason.
6. Update the ticket (or, if you lack write access, return the proposed text
   as a diff against the original). Add a comment summarizing what changed
   and why.

## Output

- Updated ticket body following the story template from
  `/sdlc-stories:spec-to-stories`.
- A short **Refinement log**: what was ambiguous, what you decided, what
  still needs a human answer (tag the owner).

## Hand-off

When the story passes the definition of ready, run
`/sdlc-codegen:implement-story`.
