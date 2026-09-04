export interface StageDefinition {
  id: string;
  plugin: string;
  title: string;
  summary: string;
  keywords: string[];
}

/** SDLC stages in pipeline order. `plugin` is the folder under plugins/. */
export const STAGES: readonly StageDefinition[] = [
  {
    id: "specs",
    plugin: "sdlc-specs",
    title: "Specifications",
    summary: "Turn problems into PRDs, tech specs, and architecture decisions.",
    keywords: [
      "spec",
      "specification",
      "prd",
      "rfc",
      "design doc",
      "requirements",
      "proposal",
      "adr",
      "architecture",
      "decision",
      "tech spec",
    ],
  },
  {
    id: "stories",
    plugin: "sdlc-stories",
    title: "Story creation",
    summary: "Decompose specs into stories and tickets with acceptance criteria.",
    keywords: [
      "story",
      "stories",
      "ticket",
      "tickets",
      "backlog",
      "epic",
      "jira",
      "linear",
      "azure boards",
      "issue",
      "issues",
      "grooming",
      "refinement",
      "acceptance criteria",
      "break down",
      "decompose",
    ],
  },
  {
    id: "codegen",
    plugin: "sdlc-codegen",
    title: "Code generation",
    summary: "Implement stories, scaffold modules, and build APIs from schemas.",
    keywords: [
      "implement",
      "implementation",
      "build",
      "feature",
      "code",
      "endpoint",
      "api",
      "scaffold",
      "new service",
      "new module",
      "new package",
      "openapi",
      "graphql",
      "protobuf",
      "schema",
    ],
  },
  {
    id: "testing",
    plugin: "sdlc-testing",
    title: "Testing",
    summary: "Close coverage gaps, automate acceptance tests, and stabilize flaky suites.",
    keywords: [
      "test",
      "tests",
      "testing",
      "coverage",
      "unit test",
      "e2e",
      "end to end",
      "integration test",
      "playwright",
      "cypress",
      "flaky",
      "intermittent",
      "ci red",
      "quarantine",
    ],
  },
  {
    id: "pr-review",
    plugin: "sdlc-pr-review",
    title: "PR review",
    summary: "Review pull requests for correctness and security; address feedback.",
    keywords: [
      "review",
      "pr",
      "pull request",
      "merge request",
      "diff",
      "security",
      "owasp",
      "vulnerability",
      "feedback",
      "comments",
      "reviewer",
    ],
  },
  {
    id: "code-hygiene",
    plugin: "sdlc-code-hygiene",
    title: "Code hygiene",
    summary: "Remove duplication and dead code; upgrade dependencies safely.",
    keywords: [
      "duplicate",
      "duplicated",
      "duplication",
      "dedupe",
      "dry",
      "copy paste",
      "refactor",
      "cleanup",
      "clean up",
      "dead code",
      "unused",
      "prune",
      "dependency",
      "dependencies",
      "upgrade",
      "bump",
      "outdated",
      "dependabot",
      "renovate",
      "cve",
    ],
  },
];

export const STAGE_ORDER: readonly string[] = STAGES.map((s) => s.id);

export function stageByPlugin(plugin: string): StageDefinition | undefined {
  return STAGES.find((s) => s.plugin === plugin);
}

export function stageById(id: string): StageDefinition | undefined {
  return STAGES.find((s) => s.id === id);
}
