---
name: dead-code-removal
description: Detect and safely delete unused exports, files, dependencies, feature flags, and config using static analysis (knip, ts-prune, vulture, deadcode, depcheck) cross-checked against runtime evidence. Use when asked to remove dead code, prune unused dependencies, retire feature flags, or shrink a codebase.
metadata:
  stage: code-hygiene
  tags: [dead-code, unused, dependencies, feature-flags, cleanup]
  inputs: [target repo or directory]
  outputs: [removal PR(s) grouped by risk, list of items kept with reasons]
  next: [sdlc-code-hygiene:dependency-upgrade, sdlc-pr-review:pr-review]
---

# Dead code removal

Available as `/sdlc-code-hygiene:dead-code-removal`.

## Steps

1. **Detect** with the stack's tool, then cross-check with a second signal:
   - TypeScript/JS: `npx knip` (exports, files, deps) or `ts-prune` + `depcheck`.
   - Python: `vulture <pkg> --min-confidence 80`, `pip-extra-reqs`/`deptry`.
   - Go: `deadcode ./...`, `staticcheck -checks U1000`.
   - .NET: IDE0051/IDE0060 analyzers, `dotnet-unused`.
   - Any: `git log -1 --format=%cd -- <file>` for last-touched dates; search
     for dynamic references (`grep -r "<name>"` including strings, reflection,
     DI registration, templates, config, and other repos that consume this
     package).
2. **Classify each candidate by risk:**
   - **Safe** — private/internal, no dynamic references, no public API,
     tests still pass when removed.
   - **Check runtime** — reachable via reflection, DI, routing tables,
     serialization, plugins, or exported from a published package. Look
     for production evidence (logs, metrics, flag evaluation counts) before
     deleting; if none is available, deprecate first.
   - **Keep** — intentionally unused (public SDK surface, interface
     conformance, platform hooks). Record why.
3. **Feature flags:** for each flag, check its evaluation state in the flag
   service. Fully-on flags → remove the flag and the *off* branch;
   fully-off for > 90 days → remove the flag and the *on* branch (confirm
   with the owner). Update the flag service config in the same PR if it
   lives in the repo.
4. **Remove** in dependency order (leaf code first, then the exports, then
   the files, then the packages). One commit per logical unit. After each
   commit run build, lint, typecheck, and tests.
5. **Dependencies:** remove from the manifest and lockfile together; verify
   the build and any Docker image still succeeds; check transitive
   requirements are not silently lost.
6. **Ship in risk tiers:** one PR of *Safe* removals, then separate PRs for
   each *Check runtime* item with the evidence in the description. Never mix
   a risky deletion into a bulk PR.

## PR description template

```markdown
## Dead code removal: <area>
**Tooling:** knip 5.x + manual grep for dynamic refs

### Removed (safe)
- `src/legacy/csvExport.ts` — no importers since 2025-11 (last commit abc123)
- dep `lodash.debounce` — replaced by native usage in #412

### Removed (runtime evidence)
- flag `checkout.v2` — 100% on for 120 days (LaunchDarkly), off branch deleted

### Kept intentionally
- `export interface PluginHost` — public SDK surface
```

## Hand-off

Run `/sdlc-code-hygiene:dependency-upgrade` if the manifest changed, then
request `/sdlc-pr-review:pr-review`.
