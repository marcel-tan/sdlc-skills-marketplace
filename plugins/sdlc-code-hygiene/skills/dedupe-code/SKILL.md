---
name: dedupe-code
description: Find duplicated and near-duplicated code with a clone detector (jscpd, PMD CPD, or the language's equivalent), decide which clones are worth consolidating, extract shared abstractions without changing behavior, and prove it with the existing tests. Use when asked to remove duplication, DRY up code, consolidate copy-pasted logic, or clean up after a feature lands.
metadata:
  stage: code-hygiene
  tags: [duplication, refactoring, dry, clone-detection, cleanup]
  inputs: [target repo or directory, optional threshold (min tokens/lines)]
  outputs: [duplication report (before/after), refactor PR(s) with behavior-preserving commits]
  next: [sdlc-code-hygiene:dead-code-removal, sdlc-pr-review:pr-review]
---

# Remove duplicated code

Available as `/sdlc-code-hygiene:dedupe-code`.

## Steps

1. **Measure.** Run a clone detector across the target, excluding generated
   code, vendored deps, fixtures, and migrations:
   - Multi-language: `npx jscpd <dir> --min-tokens 50 --reporters console,json --ignore "**/node_modules/**,**/dist/**,**/*.generated.*"`
   - Java/C#/Go/others: PMD CPD (`pmd cpd --minimum-tokens 60 --language <lang> --dir <dir>`)
   - Python: `jscpd` handles it; `pylint --disable=all --enable=duplicate-code` as a second opinion.
   Save the JSON report as the baseline.
2. **Triage clones.** Not every clone should be removed. For each group,
   decide:
   - **Consolidate** — same intent, same change history (they were edited
     together before: check `git log -L` / blame), 3+ occurrences or 2 in
     hot paths.
   - **Leave** — coincidental similarity, different owners/rates of change,
     test setup boilerplate the team prefers explicit, or consolidation
     would couple unrelated modules.
   - **Flag** — clone hides a bug (copies diverged: one got a fix the other
     did not). File a ticket; fixing behavior is out of scope for a refactor
     PR.
   Record the decision per group in the report.
3. **Plan the extraction.** For each consolidate group choose the smallest
   abstraction: shared function → shared module → parameterized class.
   Prefer extracting to an *existing* utility module over creating a new
   one; search for a helper that already does 80% of it.
4. **Refactor behavior-preservingly**, one clone group per commit:
   1. Confirm tests cover the call sites (add characterization tests via
      `/sdlc-testing:unit-test-gaps` if not).
   2. Extract the shared code; replace the first occurrence; run tests.
   3. Replace remaining occurrences one at a time; run tests after each.
   4. Delete the now-unused originals.
   Do not change behavior, naming of public APIs, or formatting outside the
   touched lines in the same commit.
5. **Re-measure.** Run the detector again; include before/after duplication
   percentage and the per-group table in the PR description.
6. Keep PRs reviewable: one PR per module or per ~300 changed lines. Large
   consolidations go through `/sdlc-specs:adr` if they introduce a new
   shared package.

## PR description template

```markdown
## Duplication cleanup: <area>
**Before:** 6.8% duplicated (jscpd, 50-token min) → **After:** 2.1%

| Clone group | Occurrences | Decision | Extracted to |
|---|---|---|---|
| currency formatting | 4 | consolidate | `src/lib/money.ts::formatCents` |
| retry wrapper | 3 | consolidate | existing `src/lib/retry.ts` |
| test fixtures | 5 | leave | — |
| discount calc (diverged) | 2 | flag → TICKET-321 | — |

No behavior changes; all existing tests pass unchanged.
```

## Hand-off

Run `/sdlc-code-hygiene:dead-code-removal` on the same area (dedupe often
orphans code), then request `/sdlc-pr-review:pr-review`.
