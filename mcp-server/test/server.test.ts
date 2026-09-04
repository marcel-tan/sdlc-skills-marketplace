import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCatalog, type Catalog } from "../src/catalog.js";
import { createServer, type ServerDeps } from "../src/server.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
let catalog: Catalog;

async function connect(deps: Partial<ServerDeps> = {}): Promise<Client> {
  const server = createServer({ catalog, devin: undefined, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text" || first.text === undefined) throw new Error("no text content");
  return first.text;
}

function jsonOf<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  return JSON.parse(textOf(result)) as T;
}

beforeAll(async () => {
  catalog = await loadCatalog(ROOT);
});

describe("MCP server", () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect();
  });
  afterAll(async () => {
    await client.close();
  });

  it("exposes the expected tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["compose_session_prompt", "get_skill", "list_skills", "list_stages", "recommend_skills", "start_devin_session"].sort(),
    );
  });

  it("list_skills filters by stage", async () => {
    const skills = jsonOf<Array<{ id: string; stage: string }>>(await client.callTool({ name: "list_skills", arguments: { stage: "testing" } }));
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) expect(s.stage).toBe("testing");
    expect(skills[0]).not.toHaveProperty("body");
  });

  it("get_skill returns the body and hand-off chain", async () => {
    const skill = jsonOf<{ id: string; body: string; handoffChain: string[] }>(
      await client.callTool({ name: "get_skill", arguments: { id: "dedupe-code" } }),
    );
    expect(skill.id).toBe("sdlc-code-hygiene:dedupe-code");
    expect(skill.body).toMatch(/^# /);
    expect(skill.handoffChain[0]).toBe("sdlc-code-hygiene:dedupe-code");
  });

  it("get_skill reports unknown ids as errors", async () => {
    const result = await client.callTool({ name: "get_skill", arguments: { id: "nope" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Unknown skill");
  });

  it("recommend_skills ranks and suggests a chain", async () => {
    const out = jsonOf<{ recommendations: Array<{ id: string }>; suggestedChain: string[] }>(
      await client.callTool({ name: "recommend_skills", arguments: { task: "review PR #12 for security issues", limit: 2 } }),
    );
    expect(out.recommendations[0]?.id).toBe("sdlc-pr-review:security-review");
    expect(out.recommendations).toHaveLength(2);
    expect(out.suggestedChain[0]).toBe("sdlc-pr-review:security-review");
  });

  it("compose_session_prompt defaults to recommended skills", async () => {
    const out = jsonOf<{ skillIds: string[]; prompt: string }>(
      await client.callTool({ name: "compose_session_prompt", arguments: { task: "the checkout e2e test is flaky in CI" } }),
    );
    expect(out.skillIds[0]).toBe("sdlc-testing:flaky-test-triage");
    expect(out.prompt).toContain("<skill id=\"sdlc-testing:flaky-test-triage\"");
  });

  it("start_devin_session fails clearly without an API key", async () => {
    const result = await client.callTool({ name: "start_devin_session", arguments: { task: "review PR #1", skill_ids: ["pr-review"] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("DEVIN_API_KEY");
  });

  it("start_devin_session dry_run returns the request without calling the API", async () => {
    const out = jsonOf<{ dryRun: boolean; skillIds: string[]; request: { prompt: string; tags: string[] } }>(
      await client.callTool({ name: "start_devin_session", arguments: { task: "review PR #1", skill_ids: ["pr-review"], dry_run: true } }),
    );
    expect(out.dryRun).toBe(true);
    expect(out.skillIds).toEqual(["sdlc-pr-review:pr-review"]);
    expect(out.request.tags).toEqual(["sdlc-skills", "pr-review"]);
    expect(out.request.prompt).toContain("# Task");
  });

  it("serves the catalog and per-skill resources", async () => {
    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === "sdlc-skills://catalog")).toBe(true);
    expect(resources.some((r) => r.uri === "sdlc-skill://sdlc-specs/write-prd")).toBe(true);
    const skill = await client.readResource({ uri: "sdlc-skill://sdlc-specs/write-prd" });
    expect(skill.contents[0]?.mimeType).toBe("text/markdown");
  });
});

describe("start_devin_session with a configured API", () => {
  it("posts to the v3 org endpoint and returns the session", async () => {
    const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("https://api.devin.ai/v3/organizations/org-1/sessions");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
      const body = JSON.parse(String(init.body)) as { prompt: string; tags: string[]; title: string };
      expect(body.prompt).toContain("sdlc-codegen:implement-story");
      expect(body.tags).toContain("codegen");
      expect(body.title).toBe("MTD-42");
      return new Response(JSON.stringify({ session_id: "devin-abc", url: "https://app.devin.ai/sessions/abc", is_new_session: true }), { status: 200 });
    });
    const client = await connect({ devin: { apiKey: "k", orgId: "org-1" }, fetchImpl });
    const out = jsonOf<{ sessionId: string; url: string; skillIds: string[] }>(
      await client.callTool({
        name: "start_devin_session",
        arguments: { task: "implement MTD-42", skill_ids: ["implement-story"], title: "MTD-42" },
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.sessionId).toBe("devin-abc");
    expect(out.url).toBe("https://app.devin.ai/sessions/abc");
    await client.close();
  });

  it("surfaces API errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = await connect({ devin: { apiKey: "bad" }, fetchImpl });
    const result = await client.callTool({ name: "start_devin_session", arguments: { task: "implement MTD-42", skill_ids: ["implement-story"] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("401");
    await client.close();
  });
});
