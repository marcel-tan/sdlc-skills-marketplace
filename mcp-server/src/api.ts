import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { z } from "zod";
import { findSkill, type Catalog, type Skill } from "./catalog.js";
import {
  createDevinSession,
  DevinApiError,
  getDevinSession,
  type CreateSessionResult,
  type DevinConfig,
  type FetchLike,
  type SessionStatus,
} from "./devin.js";
import { planLaunch, UnknownSkillError } from "./launch.js";
import { handoffChain, recommendSkills } from "./recommend.js";
import { STAGE_ORDER, STAGES } from "./stages.js";

export interface ApiDeps {
  catalog: Catalog;
  devin?: DevinConfig | undefined;
  fetchImpl?: FetchLike | undefined;
  marketplaceUrl?: string | undefined;
  /** Directory of static UI assets served at `/`. Omit to serve the JSON API only. */
  webDir?: string | undefined;
  /** Whether callers must authenticate (surfaced to the UI via /api/config; enforcement happens in bin.ts). */
  authRequired?: boolean | undefined;
}

/** A session launched through this server, kept in memory for the lifetime of the process. */
export interface LaunchedSession extends CreateSessionResult {
  task: string;
  skillIds: string[];
  repo: string | null;
  title: string | null;
  launchedAt: string;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_LAUNCHED = 200;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const modeSchema = z.enum(["inline", "reference"]).default("inline");
const recommendSchema = z.object({ task: z.string().min(3), limit: z.number().int().min(1).max(10).default(5) });
const composeSchema = z.object({
  task: z.string().min(3),
  skillIds: z.array(z.string()).optional(),
  repo: z.string().optional(),
  context: z.string().optional(),
  mode: modeSchema,
});
const launchSchema = composeSchema.extend({
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  playbookId: z.string().optional(),
  maxAcuLimit: z.number().int().positive().optional(),
  unlisted: z.boolean().optional(),
  idempotent: z.boolean().optional(),
  dryRun: z.boolean().default(false),
});

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function skillSummary(s: Skill) {
  const { body: _body, ...rest } = s;
  return rest;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, "invalid request", z.treeifyError(result.error));
  return result.data;
}

function pathnameOf(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}

export interface ApiHandler {
  /** Returns true if the request was handled (API or static asset), false if it should fall through. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  launched(): readonly LaunchedSession[];
}

export function createApiHandler(deps: ApiDeps): ApiHandler {
  const { catalog } = deps;
  const launched: LaunchedSession[] = [];
  const webRoot = deps.webDir ? resolve(deps.webDir) : undefined;

  function requireDevin(): DevinConfig {
    if (!deps.devin) {
      throw new HttpError(503, "DEVIN_API_KEY is not configured on this server; set it (and optionally DEVIN_ORG_ID) to launch sessions.");
    }
    return deps.devin;
  }

  async function route(method: string, pathname: string, req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    if (method === "GET" && pathname === "/api/config") {
      return {
        status: 200,
        body: {
          devinConfigured: Boolean(deps.devin),
          devinEndpoint: deps.devin?.orgId ? "v3" : "v1",
          authRequired: Boolean(deps.authRequired),
          marketplaceUrl: deps.marketplaceUrl ?? null,
          stages: STAGES.map((st) => ({ id: st.id, title: st.title, plugin: st.plugin, summary: st.summary })),
          skillCount: catalog.skills.length,
        },
      };
    }

    if (method === "GET" && pathname === "/api/skills") {
      const skills = [...catalog.skills]
        .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.id.localeCompare(b.id))
        .map(skillSummary);
      return { status: 200, body: { skills } };
    }

    const skillMatch = /^\/api\/skills\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (method === "GET" && skillMatch) {
      const id = `${decodeURIComponent(skillMatch[1]!)}:${decodeURIComponent(skillMatch[2]!)}`;
      const s = findSkill(catalog, id);
      if (!s) throw new HttpError(404, `unknown skill ${id}`);
      return { status: 200, body: { ...skillSummary(s), body: s.body, handoffChain: handoffChain(catalog, s.id) } };
    }

    if (method === "POST" && pathname === "/api/recommend") {
      const { task, limit } = parse(recommendSchema, await readJsonBody(req));
      const recommendations = recommendSkills(catalog, task, limit);
      const top = recommendations[0];
      return { status: 200, body: { task, recommendations, suggestedChain: top ? handoffChain(catalog, top.id) : [] } };
    }

    if (method === "POST" && pathname === "/api/compose") {
      const input = parse(composeSchema, await readJsonBody(req));
      const plan = planLaunch(catalog, { ...input, marketplaceUrl: deps.marketplaceUrl });
      return { status: 200, body: { skillIds: plan.skillIds, prompt: plan.prompt } };
    }

    if (method === "GET" && pathname === "/api/sessions") {
      return { status: 200, body: { sessions: launched } };
    }

    if (method === "POST" && pathname === "/api/sessions") {
      const input = parse(launchSchema, await readJsonBody(req));
      const plan = planLaunch(catalog, { ...input, marketplaceUrl: deps.marketplaceUrl });
      if (input.dryRun) return { status: 200, body: { dryRun: true, skillIds: plan.skillIds, request: plan.request } };
      const devin = requireDevin();
      const result = await createDevinSession(devin, plan.request, deps.fetchImpl);
      const record: LaunchedSession = {
        ...result,
        task: input.task,
        skillIds: plan.skillIds,
        repo: input.repo ?? null,
        title: input.title ?? null,
        launchedAt: new Date().toISOString(),
      };
      launched.unshift(record);
      if (launched.length > MAX_LAUNCHED) launched.length = MAX_LAUNCHED;
      return { status: 201, body: record };
    }

    const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
    if (method === "GET" && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]!);
      if (!launched.some((s) => s.sessionId === id)) throw new HttpError(404, `session ${id} was not launched by this server`);
      const devin = requireDevin();
      const status: SessionStatus = await getDevinSession(devin, id, deps.fetchImpl);
      return { status: 200, body: status };
    }

    throw new HttpError(404, `no route for ${method} ${pathname}`);
  }

  async function serveStatic(pathname: string, res: ServerResponse, headOnly: boolean): Promise<boolean> {
    if (!webRoot) return false;
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = normalize(join(webRoot, rel));
    if (!file.startsWith(webRoot + sep) && file !== webRoot) return false;
    let info;
    try {
      info = await stat(file);
    } catch {
      return false;
    }
    if (!info.isFile()) return false;
    const type = MIME[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": info.size, "cache-control": "no-cache" });
    res.end(headOnly ? undefined : await readFile(file));
    return true;
  }

  return {
    launched: () => launched,
    async handle(req, res) {
      const pathname = pathnameOf(req);
      const method = req.method ?? "GET";
      if (pathname.startsWith("/api/")) {
        try {
          const { status, body } = await route(method, pathname, req);
          sendJson(res, status, body);
        } catch (err) {
          if (err instanceof HttpError) sendJson(res, err.status, { error: err.message, details: err.details });
          else if (err instanceof UnknownSkillError) sendJson(res, 400, { error: err.message, missing: err.missing });
          else if (err instanceof DevinApiError) sendJson(res, 502, { error: err.message, upstreamStatus: err.status, upstreamBody: err.body.slice(0, 2000) });
          else sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }
      if (method === "GET" || method === "HEAD") return serveStatic(pathname, res, method === "HEAD");
      return false;
    },
  };
}
