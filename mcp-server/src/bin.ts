#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadCatalog } from "./catalog.js";
import { createServer } from "./server.js";

const USAGE = `sdlc-skills-mcp [--http] [--port <n>] [--host <addr>] [--root <dir>]

  (default)      serve MCP over stdio
  --http         serve MCP over streamable HTTP at /mcp (stateless)
  --port <n>     HTTP port (default $PORT or 3333)
  --host <addr>  HTTP bind address (default 127.0.0.1; use 0.0.0.0 in containers)
  --root <dir>   marketplace root containing plugins/ (default: this package, or $SDLC_SKILLS_ROOT)

env: DEVIN_API_KEY, DEVIN_ORG_ID (optional, selects the v3 endpoint), DEVIN_API_BASE_URL (optional)
`;

interface Args {
  http: boolean;
  port: number;
  host: string;
  root: string;
}

function parseArgs(argv: string[]): Args {
  const defaultRoot = process.env.SDLC_SKILLS_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args: Args = { http: false, port: Number(process.env.PORT ?? 3333), host: "127.0.0.1", root: defaultRoot };
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

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, skills: catalog.skills.length }));
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found; MCP endpoint is /mcp");
      return;
    }
    // Stateless: a fresh server + transport per request, so any client can call any tool without session bookkeeping.
    const server = createServer({ catalog });
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

  httpServer.listen(args.port, args.host, () => log(`listening on http://${args.host}:${args.port}/mcp`));
  const shutdown = () => httpServer.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`[sdlc-skills-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
