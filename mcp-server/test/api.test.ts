import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiHandler, type ApiDeps, type ApiHandler } from "../src/api.js";
import { loadCatalog, type Catalog } from "../src/catalog.js";
import { createDevinSession, devinConfigFromEnv, normalizeSession } from "../src/devin.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
let catalog: Catalog;

interface Harness {
  base: string;
  handler: ApiHandler;
  server: Server;
  fetchImpl: ReturnType<typeof vi.fn>;
}

async function start(deps: Partial<ApiDeps> = {}): Promise<Harness> {
  const fetchImpl = vi.fn();
  const handler = createApiHandler({ catalog, webDir: resolve(ROOT, "web"), fetchImpl, ...deps });
  const server = createServer(async (req, res) => {
    if (!(await handler.handle(req, res))) {
      res.writeHead(404);
      res.end("fallthrough");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, handler, server, fetchImpl };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  catalog = await loadCatalog(ROOT);
});

describe("JSON API (no Devin key)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start();
  });
  afterAll(() => h.server.close());

  it("serves the UI and static assets, refusing path traversal", async () => {
    const index = await fetch(h.base + "/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("Skills Launcher");
    expect((await fetch(h.base + "/app.js")).headers.get("content-type")).toContain("javascript");
    expect((await fetch(h.base + "/../package.json")).status).toBe(404);
    expect((await fetch(h.base + "/nope.txt")).status).toBe(404);
  });

  it("GET /api/config reports Devin as unconfigured", async () => {
    const cfg = await json(await fetch(h.base + "/api/config"));
    expect(cfg.devinConfigured).toBe(false);
    expect(cfg.skillCount).toBe(catalog.skills.length);
    expect((cfg.stages as unknown[]).length).toBe(6);
  });

  it("GET /api/skills lists summaries in stage order; GET one returns the body", async () => {
    const { skills } = (await json(await fetch(h.base + "/api/skills"))) as { skills: Array<{ id: string; stage: string; body?: string }> };
    expect(skills.length).toBe(catalog.skills.length);
    expect(skills[0]?.stage).toBe("specs");
    expect(skills.at(-1)?.stage).toBe("code-hygiene");
    expect(skills[0]).not.toHaveProperty("body");

    const one = await json(await fetch(h.base + "/api/skills/sdlc-code-hygiene/dedupe-code"));
    expect(one.id).toBe("sdlc-code-hygiene:dedupe-code");
    expect(String(one.body)).toContain("# ");
    expect((await fetch(h.base + "/api/skills/sdlc-nope/missing")).status).toBe(404);
  });

  it("POST /api/recommend ranks skills and validates input", async () => {
    const res = await post(h.base, "/api/recommend", { task: "review PR #42 for security issues", limit: 3 });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { recommendations: Array<{ id: string }>; suggestedChain: string[] };
    expect(body.recommendations[0]?.id).toBe("sdlc-pr-review:security-review");
    expect(body.suggestedChain[0]).toBe("sdlc-pr-review:security-review");

    const bad = await post(h.base, "/api/recommend", { task: "x" });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toBe("invalid request");
  });

  it("POST /api/compose builds the prompt and rejects unknown skills", async () => {
    const res = await post(h.base, "/api/compose", { task: "add tests", skillIds: ["unit-test-gaps"], repo: "github.com/acme/api", mode: "reference" });
    const body = (await json(res)) as { skillIds: string[]; prompt: string };
    expect(body.skillIds).toEqual(["sdlc-testing:unit-test-gaps"]);
    expect(body.prompt).toContain("github.com/acme/api");
    expect(body.prompt).toContain("/sdlc-testing:unit-test-gaps");

    const bad = await post(h.base, "/api/compose", { task: "add tests", skillIds: ["nope"] });
    expect(bad.status).toBe(400);
    expect((await json(bad)).missing).toEqual(["nope"]);
  });

  it("POST /api/sessions dry-runs without a key and 503s for a real launch", async () => {
    const dry = await post(h.base, "/api/sessions", { task: "find duplicated code in payments", dryRun: true });
    const body = (await json(dry)) as { dryRun: boolean; skillIds: string[]; request: { tags: string[] } };
    expect(body.dryRun).toBe(true);
    expect(body.skillIds[0]).toBe("sdlc-code-hygiene:dedupe-code");
    expect(body.request.tags).toContain("sdlc-skills");

    const real = await post(h.base, "/api/sessions", { task: "find duplicated code in payments" });
    expect(real.status).toBe(503);
    expect(String((await json(real)).error)).toContain("DEVIN_API_KEY");
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and unknown routes", async () => {
    const res = await fetch(h.base + "/api/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(res.status).toBe(400);
    expect((await fetch(h.base + "/api/whatever")).status).toBe(404);
    expect((await fetch(h.base + "/api/skills", { method: "DELETE" })).status).toBe(404);
  });
});

describe("JSON API (Devin configured)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start({ devin: { apiKey: "k", orgId: "org-1" }, authRequired: true });
  });
  afterAll(() => h.server.close());

  it("launches a session, records it, and reports live status", async () => {
    h.fetchImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ session_id: "devin-abc", url: "https://app.devin.ai/sessions/abc", is_new_session: true }), { status: 200 }),
    );
    const res = await post(h.base, "/api/sessions", { task: "implement the CSV export story", skillIds: ["implement-story"], title: "CSV export", repo: "github.com/acme/api" });
    expect(res.status).toBe(201);
    const body = (await json(res)) as { sessionId: string; url: string; skillIds: string[]; repo: string };
    expect(body.sessionId).toBe("devin-abc");
    expect(body.skillIds).toEqual(["sdlc-codegen:implement-story"]);
    expect(body.repo).toBe("github.com/acme/api");

    const [url, init] = h.fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.devin.ai/v3/organizations/org-1/sessions");
    const sent = JSON.parse(String(init.body)) as { title: string; tags: string[]; prompt: string };
    expect(sent.title).toBe("CSV export");
    expect(sent.tags).toEqual(["sdlc-skills", "codegen"]);
    expect(sent.prompt).toContain("implement the CSV export story");

    const list = (await json(await fetch(h.base + "/api/sessions"))) as { sessions: Array<{ sessionId: string }> };
    expect(list.sessions.map((s) => s.sessionId)).toEqual(["devin-abc"]);
    expect(h.handler.launched()).toHaveLength(1);

    h.fetchImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ session_id: "devin-abc", url: "https://app.devin.ai/sessions/abc", status: "running", status_detail: "waiting_for_user", title: "CSV export", pull_requests: [{ url: "https://github.com/acme/api/pull/7" }], updated_at: 1_700_000_000 }), { status: 200 }),
    );
    const status = (await json(await fetch(h.base + "/api/sessions/devin-abc"))) as { state: string; pullRequests: string[]; status: string };
    expect(status.state).toBe("blocked");
    expect(status.status).toBe("running (waiting_for_user)");
    expect(status.pullRequests).toEqual(["https://github.com/acme/api/pull/7"]);
    expect((h.fetchImpl.mock.calls[1] as [string])[0]).toBe("https://api.devin.ai/v3/organizations/org-1/sessions/devin-abc");
  });

  it("refuses status lookups for sessions this server did not launch", async () => {
    const calls = h.fetchImpl.mock.calls.length;
    const res = await fetch(h.base + "/api/sessions/devin-someone-elses");
    expect(res.status).toBe(404);
    expect(h.fetchImpl.mock.calls.length).toBe(calls);
  });

  it("maps malformed upstream 2xx bodies to 502", async () => {
    h.fetchImpl.mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    const res = await fetch(h.base + "/api/sessions/devin-abc");
    expect(res.status).toBe(502);
    expect(String((await json(res)).upstreamBody)).toContain("gateway");
  });

  it("surfaces Devin API failures as 502 with the upstream body", async () => {
    h.fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "quota exceeded" }), { status: 402 }));
    const res = await post(h.base, "/api/sessions", { task: "write a PRD for billing" });
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.upstreamStatus).toBe(402);
    expect(String(body.upstreamBody)).toContain("quota exceeded");
  });

  it("GET /api/config advertises auth + endpoint", async () => {
    const cfg = await json(await fetch(h.base + "/api/config"));
    expect(cfg.devinConfigured).toBe(true);
    expect(cfg.devinEndpoint).toBe("v3");
    expect(cfg.authRequired).toBe(true);
  });
});

describe("devinConfigFromEnv", () => {
  it("returns undefined without a key", () => {
    expect(devinConfigFromEnv({})).toBeUndefined();
  });

  it("rejects a service-user key without DEVIN_ORG_ID", () => {
    expect(() => devinConfigFromEnv({ DEVIN_API_KEY: "cog_abc" })).toThrow(/DEVIN_ORG_ID/);
    expect(() => devinConfigFromEnv({ DEVIN_API_KEY: "cog_abc", DEVIN_ORG_ID: "  " })).toThrow(/DEVIN_ORG_ID/);
  });

  it("accepts a service-user key with DEVIN_ORG_ID, and legacy keys without", () => {
    expect(devinConfigFromEnv({ DEVIN_API_KEY: "cog_abc", DEVIN_ORG_ID: "org-1" })).toMatchObject({ apiKey: "cog_abc", orgId: "org-1" });
    expect(devinConfigFromEnv({ DEVIN_API_KEY: "legacy" })).toMatchObject({ apiKey: "legacy", orgId: undefined });
  });

  it("hints at DEVIN_ORG_ID when the v1 endpoint rejects the key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 403 }));
    await expect(createDevinSession({ apiKey: "legacy" }, { prompt: "x" }, fetchImpl)).rejects.toThrow(/set DEVIN_ORG_ID/);
    await expect(createDevinSession({ apiKey: "k", orgId: "org-1" }, { prompt: "x" }, fetchImpl)).rejects.toThrow(/^Devin API 403 from [^—]*$/);
  });
});

describe("normalizeSession", () => {
  it("maps v1 shapes", () => {
    const s = normalizeSession({ session_id: "devin-x", status: "blocked", status_enum: "blocked", pull_request: { url: "https://g/pr/1" }, updated_at: "2026-01-01T00:00:00Z" });
    expect(s).toMatchObject({ state: "blocked", url: "https://app.devin.ai/sessions/x", pullRequests: ["https://g/pr/1"], updatedAt: "2026-01-01T00:00:00Z" });
  });

  it("maps v3 shapes", () => {
    expect(normalizeSession({ session_id: "devin-y", status: "exit", status_detail: "finished" }).state).toBe("finished");
    expect(normalizeSession({ session_id: "devin-y", status: "error" }).state).toBe("error");
    expect(normalizeSession({ session_id: "devin-y", status: "suspended", status_detail: "inactivity" }).state).toBe("suspended");
    expect(normalizeSession({ session_id: "devin-y", status: "claimed" }).state).toBe("running");
    expect(normalizeSession({ session_id: "devin-y" }).state).toBe("unknown");
  });
});
