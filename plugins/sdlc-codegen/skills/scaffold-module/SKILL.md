---
name: scaffold-module
description: Scaffold a new module, package, or service that follows the repository's existing conventions for layout, config, tests, CI, and docs - by copying the shape of the best existing example rather than a generic template. Use when asked to create a new service, package, module, or bounded context.
metadata:
  stage: codegen
  tags: [scaffold, new-service, new-package, boilerplate, conventions]
  inputs: [module/service name and purpose, target repo, reference module (optional)]
  outputs: [new module with build/test/CI wiring, README, one passing smoke test, PR]
  next: [sdlc-codegen:implement-story, sdlc-codegen:api-from-spec]
---

# Scaffold a module or service

Available as `/sdlc-codegen:scaffold-module`.

## Principle

The repo already knows how it likes to be structured. Your job is to find the
best existing example and reproduce its shape, not to import a template from
elsewhere.

## Steps

1. Inventory the repo: package manager and workspace config
   (`package.json` workspaces, `pnpm-workspace.yaml`, `go.work`,
   `pyproject.toml`, `*.sln`), CI config, Dockerfiles, and how existing
   modules are registered (DI containers, route tables, module lists).
2. Pick the reference module: the most recently created one that is similar
   in kind (service vs library vs UI package). Read every file in it.
3. List what must exist for the new module to be "real" in this repo:
   - build/test config and workspace registration
   - lint/format config inheritance
   - CI job or matrix entry
   - Dockerfile / deployment manifest / Helm values (if services have them)
   - env var and secret declarations (with placeholders, never values)
   - README with purpose, run, and test commands
   - health/readiness endpoint (services) or public entrypoint (libraries)
   - one smoke test that runs in CI
4. Create the module by mirroring the reference. Rename consistently
   (search the reference module's name across the repo to find every
   registration point you must replicate).
5. Run the repo's install, build, lint, and test commands and confirm the new
   smoke test runs in the same CI job as its siblings.
6. Open a PR containing only the scaffold. Feature code comes in follow-up
   stories.

## PR description must include

- Reference module used and any deliberate deviations (with reasons).
- The registration points touched (workspace, CI, DI, routing).
- Commands to run and test the module locally.

## Hand-off

Implement features with `/sdlc-codegen:implement-story`; for schema-first
APIs use `/sdlc-codegen:api-from-spec`.
