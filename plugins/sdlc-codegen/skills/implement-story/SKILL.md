---
name: implement-story
description: Implement a refined story or ticket end to end - branch, code, tests, lint, and a PR whose description traces back to the acceptance criteria. Use when asked to implement, build, or ship a ticket, story, or feature that already has acceptance criteria.
metadata:
  stage: codegen
  tags: [implementation, feature, ticket, pull-request]
  inputs: [ticket ID or story text with acceptance criteria, target repo]
  outputs: [PR with AC checklist, tests covering each AC, ticket moved to In Review]
  next: [sdlc-testing:unit-test-gaps, sdlc-pr-review:pr-review]
---

# Implement a story

Available as `/sdlc-codegen:implement-story`.

## Before writing code

1. Fetch the ticket and its parent spec. If acceptance criteria are missing
   or untestable, stop and run `/sdlc-stories:story-refinement` first.
2. Read `AGENTS.md`, `CONTRIBUTING.md`, and the repo's lint/test commands.
   Find the nearest existing feature that resembles this one and read it
   fully — match its structure, naming, and test style.
3. Write a 3–6 line implementation plan mapping each AC to the files you
   will touch and the test that will prove it. Keep it in your head or the
   task list, not in the repo.
4. Create a branch named per the repo convention; if none, use
   `<ticket-id>-<slug>`.

## Implementation loop

For each acceptance criterion, in dependency order:

1. Write or extend the test that fails for this AC.
2. Make the smallest change that passes it. Prefer editing existing modules
   over creating new ones; reuse existing helpers (search before writing).
3. Run the focused test, then the affected package's full test suite.
4. Commit with a message that names the AC (`feat(orders): split payment
   totals [STORY-3 AC2]`).

Rules:
- No drive-by refactors or formatting churn outside the touched lines.
- No new dependency without checking it is not already present and noting
  it in the PR description.
- Feature-flag anything user-visible that is not complete in this PR.
- Handle the error paths the story lists; do not swallow exceptions.

## Before opening the PR

- Run the full lint, typecheck, and test commands from the repo config.
- Re-read the diff top to bottom as a reviewer would. Remove debug output,
  commented code, and TODOs without a ticket.
- If the story has UI, capture a screenshot or short recording.

## PR description template

```markdown
## Summary
<1–3 sentences: what changed and why, linking the ticket>

## Acceptance criteria
- [x] AC1 <text> — `path/to/test.spec.ts::name`
- [x] AC2 ...
- [ ] AC3 <deferred to STORY-4 because ...>

## Notes for reviewers
<design choices, new deps, flags, migrations, anything surprising>

## Testing
<commands run; screenshots if UI>
```

Move the ticket to *In Review* and link the PR.

## Hand-off

Run `/sdlc-testing:unit-test-gaps` if coverage dropped, then request
`/sdlc-pr-review:pr-review`.
