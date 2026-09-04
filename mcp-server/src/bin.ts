#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createApiHandler } from "./api.js";
import { loadCatalog } from "./catalog.js";
import { devinConfigFromEnv } from "./devin.js";
import { createServer } from "./server.js";

const USAGE = `sdlc-skills-mcp [--http] [--port <n>] [--host <addr>] [--root <dir>] [--no-ui]

  (default)      serve MCP over stdio
  --http         serve MCP over streamable HTTP at /mcp (stateless), the JSON API at /api/*,
                 and the launcher web UI at /
  --no-ui        HTTP mode without the web UI and /api/* routes
  --port <n>     HTTP port (default $PORT or 3333)
  --host <addr>  HTTP bind address (default 127.0.0.1; use 0.0.0.0 in containers)
  --root <dir>   marketplace root containing plugins/ (default: this package, or $SDLC_SKILLS_ROOT)

env: DEVIN_API_KEY, DEVIN_ORG_ID (required for service-user cog_ keys; selects the v3 endpoint),
     DEVIN_API_BASE_URL (optional)
     MCP_AUTH_TOKEN  bearer token required on /mcp and /api/* in HTTP mode; mandatory when binding a
                     non-loopback host with DEVIN_API_KEY set (launching sessions spends credits)
`;

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** True only if every address the bind host resolves to is a loopback address. */
async function isLoopbackHost(host: string): Promise<boolean> {
  const isLoopbackAddr = (a: string) => /^127\./.test(a) || a === "::1" || /^::ffff:127\./i.test(a);
  if (isIP(host)) return isLoopbackAddr(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => isLoopbackAddr(a.address));
  } catch {
    return false;
  }
}

function bearerMatches(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function pathnameOf(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}

interface Args {
  http: boolean;
  ui: boolean;
  port: number;
  host: string;
  root: string;
}

function parseArgs(argv: string[]): Args {
  const defaultRoot = process.env.SDLC_SKILLS_ROOT ?? PACKAGE_DIR;
  const args: Args = { http: false, ui: true, port: Number(process.env.PORT ?? 3333), host: "127.0.0.1", root: defaultRoot };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--http":
        args.http = true;
        break;
      case "--no-ui":
        args.ui = false;
        break;
      case "--port":
        args.port = Number(next());
        break;
      case "--host":
        args.host = next();
        break;
      case "--root":
        args.root = resolve(next());
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        throw new Error(`unknown argument ${a}\n\n${USAGE}`);
    }
  }
  if (!Number.isInteger(args.port) || args.port <= 0) throw new Error(`invalid port ${args.port}`);
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const catalog = await loadCatalog(args.root);
  const log = (msg: string) => process.stderr.write(`[sdlc-skills-mcp] ${msg}\n`);
  log(`loaded ${catalog.skills.length} skills from ${catalog.plugins.length} plugins (${args.root})`);

  if (!args.http) {
    const server = createServer({ catalog });
    await server.connect(new StdioServerTransport());
    return;
  }

  const authToken = process.env.MCP_AUTH_TOKEN;
  if (!authToken && process.env.DEVIN_API_KEY && !(await isLoopbackHost(args.host))) {
    throw new Error(
      `refusing to bind ${args.host} with DEVIN_API_KEY but no MCP_AUTH_TOKEN: anyone reaching /mcp could start paid Devin sessions. Set MCP_AUTH_TOKEN or bind 127.0.0.1.`,
    );
  }
  if (!authToken) log("MCP_AUTH_TOKEN not set; /mcp and /api are unauthenticated");

  const devin = devinConfigFromEnv();
  const api = args.ui
    ? createApiHandler({ catalog, devin, webDir: resolve(PACKAGE_DIR, "web"), authRequired: Boolean(authToken) })
    : undefined;

  const httpServer = createHttpServer(async (req, res) => {
    const pathname = pathnameOf(req);
    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, skills: catalog.skills.length }));
      return;
    }
    const protectedPath = pathname === "/mcp" || pathname.startsWith("/api/");
    if (protectedPath && authToken && !bearerMatches(req, authToken)) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
      return;
    }
    if (pathname !== "/mcp") {
      if (api && (await api.handle(req, res))) return;
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(api ? "not found" : "not found; MCP endpoint is /mcp");
      return;
    }
    // Stateless: a fresh server + transport per request, so any client can call any tool without session bookkeeping.
    const server = createServer({ catalog, devin });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      log(`request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
      }
    }
  });

  httpServer.listen(args.port, args.host, () => {
    log(`MCP endpoint: http://${args.host}:${args.port}/mcp`);
    if (api) {
      const devinState = devin ? `configured: ${devin.orgId ? "v3 org " + devin.orgId : "legacy v1 endpoint"}` : "NOT configured: launches disabled";
      log(`launcher UI:  http://${args.host}:${args.port}/  (Devin API ${devinState})`);
    }
  });
  const shutdown = () => httpServer.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`[sdlc-skills-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
