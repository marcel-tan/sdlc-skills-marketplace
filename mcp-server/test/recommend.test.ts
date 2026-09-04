import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCatalog, type Catalog } from "../src/catalog.js";
import { composeSessionPrompt } from "../src/prompt.js";
import { handoffChain, recommendSkills, stem, tokenize } from "../src/recommend.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadCatalog(ROOT);
});

describe("tokenize/stem", () => {
  it("lowercases, drops stopwords and stems plurals/gerunds", () => {
    expect(tokenize("Reviewing the Pull Requests for duplicated tests")).toEqual(["review", "pull", "request", "duplicat", "test"]);
    expect(stem("stories")).toBe("story");
    expect(stem("flaky")).toBe("flaky");
  });
});

describe("recommendSkills", () => {
  const cases: Array<[string, string]> = [
    ["implement ticket MTD-42: add split payments endpoint", "sdlc-codegen:implement-story"],
    ["find and remove duplicated code in services/order-ahead", "sdlc-code-hygiene:dedupe-code"],
    ["review PR #12 for security issues", "sdlc-pr-review:security-review"],
    ["write a PRD for catering pre-orders", "sdlc-specs:write-prd"],
    ["break the spec into jira tickets", "sdlc-stories:create-tickets"],
    ["the checkout e2e test is flaky in CI", "sdlc-testing:flaky-test-triage"],
    ["prune unused dependencies and dead code", "sdlc-code-hygiene:dead-code-removal"],
    ["write unit tests to raise coverage on the pricing module", "sdlc-testing:unit-test-gaps"],
    ["address the review comments on my PR", "sdlc-pr-review:address-review-feedback"],
    ["record an ADR for choosing Postgres over DynamoDB", "sdlc-specs:adr"],
    ["scaffold a new notifications service", "sdlc-codegen:scaffold-module"],
    ["bump dependencies to fix the CVE from dependabot", "sdlc-code-hygiene:dependency-upgrade"],
  ];
  for (const [task, expected] of cases) {
    it(`ranks ${expected} first for "${task}"`, () => {
      const r = recommendSkills(catalog, task, 3);
      expect(r[0]?.id).toBe(expected);
      expect(r[0]?.reasons.length).toBeGreaterThan(0);
      expect(r.length).toBeLessThanOrEqual(3);
    });
  }

  it("returns an empty list for unrelated tasks", () => {
    expect(recommendSkills(catalog, "zzz qqq xyzzy", 3)).toEqual([]);
  });
});

describe("handoffChain", () => {
  it("follows next links without repeating", () => {
    const chain = handoffChain(catalog, "sdlc-specs:write-prd");
    expect(chain[0]).toBe("sdlc-specs:write-prd");
    expect(new Set(chain).size).toBe(chain.length);
    expect(chain.length).toBeGreaterThan(2);
  });
});

describe("composeSessionPrompt", () => {
  it("embeds skill bodies inline and lists them in order", () => {
    const skills = ["sdlc-codegen:implement-story", "sdlc-testing:unit-test-gaps"].map(
      (id) => catalog.skills.find((s) => s.id === id)!,
    );
    const prompt = composeSessionPrompt({ task: "Ship MTD-42", skills, repo: "github.com/acme/api", context: "Use pnpm." });
    expect(prompt).toContain("# Task\n\nShip MTD-42");
    expect(prompt).toContain("Repository: github.com/acme/api");
    expect(prompt).toContain("Use pnpm.");
    expect(prompt.indexOf("`/sdlc-codegen:implement-story`")).toBeLessThan(prompt.indexOf("`/sdlc-testing:unit-test-gaps`"));
    expect(prompt).toContain('<skill id="sdlc-codegen:implement-story"');
    expect(prompt).toContain(skills[0]!.body.trim());
  });

  it("reference mode omits bodies", () => {
    const skill = catalog.skills.find((s) => s.id === "sdlc-pr-review:pr-review")!;
    const prompt = composeSessionPrompt({ task: "Review PR 7", skills: [skill], mode: "reference" });
    expect(prompt).not.toContain("<skill id=");
    expect(prompt).toContain("installed as a Devin plugin");
  });
});
