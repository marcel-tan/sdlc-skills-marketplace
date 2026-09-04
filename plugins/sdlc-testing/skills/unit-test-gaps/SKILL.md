---
name: unit-test-gaps
description: Measure test coverage for a package or changed files, identify meaningful gaps (untested branches, error paths, boundary values), and write targeted unit tests using the repo's existing test framework and patterns. Use when asked to raise coverage, add tests, or when a PR lowers coverage.
metadata:
  stage: testing
  tags: [unit-tests, coverage, tdd]
  inputs: [target package or file list (default = files changed on the branch), coverage target]
  outputs: [new/updated test files, before/after coverage numbers in the PR description]
  next: [sdlc-pr-review:pr-review]
---

# Close unit-test gaps

Available as `/sdlc-testing:unit-test-gaps`.

## Steps

1. Find the test runner and coverage command (`package.json` scripts,
   `pytest.ini`/`pyproject.toml`, `go test -cover`, `dotnet test
   --collect`, `Makefile`). Run it once to get the baseline; save the report.
2. Scope: if no target is given, use the files changed on the current branch
   versus the base (`git diff --name-only --merge-base <base>`).
3. Rank gaps by risk, not by line count:
   1. Uncovered branches in error handling and input validation.
   2. Boundary values (empty, one, max, negative, unicode, timezone edges).
   3. Public functions with zero tests.
   4. Everything else.
   Skip trivial getters, generated code, and framework glue — note them as
   intentionally excluded.
4. For each gap, read the existing tests for the module (or the closest
   sibling) and copy their structure: file location, naming, fixtures,
   mocking approach, assertion style.
5. Write tests that assert behavior, not implementation:
   - One logical assertion per test; name states the expected behavior.
   - Use real collaborators where cheap; mock only I/O and time.
   - No snapshot tests for logic; no `expect(true).toBe(true)`.
   - Tests must fail if the behavior is removed — verify by temporarily
     breaking the code once, then restoring it.
6. Re-run coverage. Report before/after per file in the PR description.
7. If a gap cannot be tested without refactoring (hidden dependency, static
   singleton), do the minimal seam refactor (inject the dependency) in a
   separate commit and call it out.

## Do not

- Modify existing tests to make them pass.
- Chase 100% by testing trivial code; the target is the risky code being
  covered.
- Add tests that depend on wall-clock time, network, or ordering.

## Output

PR (or commits on the current branch) with:
- Coverage table: file, before %, after %, notes.
- List of intentionally uncovered items with reasons.

## Hand-off

Request `/sdlc-pr-review:pr-review`.
