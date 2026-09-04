---
name: dependency-upgrade
description: Upgrade dependencies safely - audit for vulnerabilities and staleness, group upgrades by risk, read changelogs for breaking changes, apply codemods, and verify with the full test suite. Use when asked to update packages, fix a vulnerability alert, bump a framework version, or resolve Dependabot/Renovate backlog.
metadata:
  stage: code-hygiene
  tags: [dependencies, upgrade, vulnerabilities, dependabot, renovate, supply-chain]
  inputs: [target repo, scope (all / specific package / security-only)]
  outputs: [one PR per risk tier with changelog summaries and test evidence]
  next: [sdlc-pr-review:security-review, sdlc-pr-review:pr-review]
---

# Dependency upgrade

Available as `/sdlc-code-hygiene:dependency-upgrade`.

## Steps

1. **Audit.** Run the ecosystem's audit and outdated commands (`npm audit`,
   `npm outdated`, `pip-audit`, `pip list --outdated`, `go list -m -u all`,
   `govulncheck`, `dotnet list package --vulnerable --outdated`,
   `cargo audit`). Also read open Dependabot/Renovate PRs so you do not
   duplicate them — close or supersede them in the description.
2. **Group by risk tier:**
   - **Tier 0 — security**: anything with a CVE; do first, minimal version
     that fixes it.
   - **Tier 1 — patch/minor, no breaking changes** per semver and changelog.
   - **Tier 2 — major** or packages with a history of breaking minors
     (frameworks, ORMs, build tools). One package (or one tightly coupled
     family) per PR.
3. **Supply-chain checks** for every new version: published ≥ 7 days ago
   (very fresh releases are the most common vector for compromised
   packages), same maintainers as before, no new install scripts, download
   counts not anomalous. Pin exact versions where the repo pins; never
   introduce floating ranges.
4. **Read the changelog / release notes** between current and target
   versions. List breaking changes and deprecations that touch this repo
   (search the codebase for each affected API).
5. **Apply.** Update manifest and lockfile together. Run official codemods
   where they exist (`npx @next/codemod`, `npx react-codemod`,
   `pyupgrade`, `go fix`, etc.). Fix compile/type errors by adopting the new
   API, not by suppressing.
6. **Verify.** Full lint, typecheck, unit, integration, and e2e suites.
   Build the Docker image if one exists. For frameworks, smoke-test the app.
   Check bundle size / startup time if the repo tracks them.
7. **Ship** one PR per tier (Tier 2: one per package). Keep each PR's diff
   limited to the upgrade and its required code changes.

## PR description template

```markdown
## Dependency upgrade — Tier 1 (minor/patch)
| Package | From | To | Notes |
|---|---|---|---|
| zod | 3.22.4 | 3.23.8 | bug fixes only |
| vitest | 1.6.0 | 1.6.1 | patch |

**Security:** resolves GHSA-xxxx (fast-xml-parser) via transitive bump.
**Supply chain:** all versions ≥ 7 days old; maintainers unchanged.
**Verification:** lint, typecheck, 1,204 unit tests, 38 e2e — all green.
Supersedes dependabot #401, #405.
```

## Hand-off

Run `/sdlc-pr-review:security-review` for Tier 0 and any new transitive
dependencies, then `/sdlc-pr-review:pr-review`.
