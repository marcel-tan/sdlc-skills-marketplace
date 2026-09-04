---
name: address-review-feedback
description: Work through reviewer comments on a PR - fix each accepted item in its own commit, push back with evidence where the reviewer is mistaken, reply per thread, and re-request review. Use when asked to address review comments, respond to a review, or get a PR ready to merge after feedback.
metadata:
  stage: pr-review
  tags: [pull-request, review-comments, iteration]
  inputs: [PR URL/number with review comments]
  outputs: [commits addressing each comment, per-thread replies, updated PR description, re-requested review]
  next: [sdlc-code-hygiene:dedupe-code]
---

# Address review feedback

Available as `/sdlc-pr-review:address-review-feedback`.

## Steps

1. Fetch all review threads (use the git provider tool/MCP; page through if
   truncated). Build a checklist: `thread → file:line → ask → decision`.
2. Triage each thread into one of:
   - **Accept** — the reviewer is right; fix it.
   - **Accept, different fix** — same goal, better implementation; explain.
   - **Push back** — the comment is mistaken or out of scope; reply with
     evidence (code reference, test, spec line). Never silently ignore.
   - **Defer** — valid but belongs in a follow-up; create the ticket via
     `/sdlc-stories:create-tickets` and link it in the reply.
   - **Needs the user** — the comment contradicts an explicit instruction
     from the task author or requires a product decision; escalate instead
     of deciding.
3. For each accepted item: make the change, run the relevant tests, commit
   with a message referencing the thread (`review: null-check order.customer
   (thread by @reviewer)`). One logical fix per commit so the reviewer can
   verify each.
4. Never amend or force-push over commits the reviewer has already read;
   add new commits. Rebase only if the reviewer asks or the base moved and
   there are conflicts.
5. Reply on every thread with what you did and the commit SHA, or the
   push-back reasoning. Do not resolve threads you did not open unless the
   repo's convention is author-resolves.
6. Re-run the full lint/typecheck/test suite. Update the PR description if
   the change set's scope or approach changed.
7. Re-request review from the same reviewers. Post one summary comment:

```markdown
Addressed review (N threads):
- Fixed: <list with SHAs>
- Deferred to <TICKET-123>: <list>
- Pushed back (see threads): <list>
```

## Guardrails

- Bot/automated review comments (Devin Review, linters) get the same
  treatment; low-severity nits that need large changes are escalated to the
  user rather than fixed silently.
- If addressing a comment would reverse an explicit instruction from the
  task author, stop and ask.

## Hand-off

After merge, consider `/sdlc-code-hygiene:dedupe-code` on the touched
modules if the review flagged duplication.
