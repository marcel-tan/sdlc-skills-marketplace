---
name: api-from-spec
description: Generate or update API endpoints, request/response types, validation, and contract tests from an OpenAPI, GraphQL, protobuf, or JSON Schema definition - schema first, using the repo's existing codegen toolchain when present. Use when asked to add or change an API, endpoint, or contract.
metadata:
  stage: codegen
  tags: [api, openapi, graphql, protobuf, schema-first, contract-tests]
  inputs: [schema file or spec section describing the API, target repo]
  outputs: [updated schema, generated/handwritten types, handlers with validation, contract tests, PR]
  next: [sdlc-testing:e2e-from-acceptance-criteria, sdlc-pr-review:pr-review]
---

# API from spec

Available as `/sdlc-codegen:api-from-spec`.

## Steps

1. Find the source of truth for API contracts in this repo (`openapi.yaml`,
   `schema.graphql`, `*.proto`, JSON Schema, or code-first decorators). If
   the repo is code-first, follow that and generate the schema *from* code
   instead — do not introduce a second source of truth.
2. Find the existing codegen pipeline (`openapi-generator`, `orval`,
   `graphql-codegen`, `buf`, `protoc`, framework-native tooling) and the
   command that runs it. Never hand-edit generated files.
3. Change the schema first:
   - New endpoints/fields are additive. Breaking changes require a version
     bump or a new path and an ADR (`/sdlc-specs:adr`).
   - Document every field (description, format, constraints, example).
   - Define error responses explicitly (4xx/5xx shapes reuse the repo's
     standard error envelope).
4. Run codegen and commit generated output separately from handwritten code
   if the repo commits generated files.
5. Implement handlers:
   - Validate at the boundary using the generated validators or the repo's
     validation library; reject unknown fields if the API is strict.
   - Enforce authn/authz the same way neighboring endpoints do.
   - Map domain errors to the documented error responses.
6. Write contract tests that exercise each documented response code with
   the schema as the oracle (e.g. response validated against the OpenAPI
   schema). Add at least one negative test per validation rule.
7. Update API docs/changelog if the repo maintains them; regenerate client
   SDKs if they live in this repo.

## Checklist before PR

- Schema lint passes (`spectral`, `buf lint`, `graphql-schema-linter`, or
  the repo's equivalent).
- No breaking change detected (`oasdiff`, `buf breaking`, or schema diff
  review) — or the break is versioned and documented.
- Pagination, idempotency, and rate-limit headers match existing endpoints.

## Hand-off

Derive end-to-end tests with `/sdlc-testing:e2e-from-acceptance-criteria`,
then request `/sdlc-pr-review:pr-review`.
