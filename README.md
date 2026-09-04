# sdlc-skills-marketplace

Centralized SDLC skills for Devin, distributed two ways:

1. **Devin plugins** — six stage plugins (specs → stories → codegen → testing → pr-review → code-hygiene) plus a root meta-plugin that installs them all.
2. **MCP server** — `recommend_skills` picks the right skills for a task, `compose_session_prompt` builds a prompt that embeds them, and `start_devin_session` launches a Devin session with that prompt.

## Skills

| Stage | Plugin | Skills |
| --- | --- | --- |
| Specifications | `sdlc-specs` | `write-prd`, `spec-review`, `adr` |
| Story creation | `sdlc-stories` | `spec-to-stories`, `story-refinement`, `create-tickets` |
| Code generation | `sdlc-codegen` | `implement-story`, `scaffold-module`, `api-from-spec` |
| Testing | `sdlc-testing` | `unit-test-gaps`, `e2e-from-acceptance-criteria`, `flaky-test-triage` |
| PR review | `sdlc-pr-review` | `pr-review`, `security-review`, `address-review-feedback` |
| Code hygiene | `sdlc-code-hygiene` | `dedupe-code`, `dead-code-removal`, `dependency-upgrade` |

Each `SKILL.md` has frontmatter with `metadata.stage`, `tags`, `inputs`, `outputs`, and `next` (the hand-off), so a session that starts with `write-prd` is guided through `spec-review → spec-to-stories → implement-story → unit-test-gaps → pr-review → dedupe-code`. [`catalog.json`](./catalog.json) is the generated index of all of this.

Skills are tool-agnostic: `create-tickets` detects Jira / Linear / Azure Boards / GitHub Issues from the MCPs available in the session; codegen and testing skills follow whatever conventions the target repo already uses.

## Install as a Devin plugin

In Devin → Settings → Plugins, add this repository as a marketplace source. Install the root plugin to get every stage, or pick individual stage plugins:

```text
https://github.com/marcel-tan/sdlc-skills-marketplace                       # everything (meta-plugin)
https://github.com/marcel-tan/sdlc-skills-marketplace  path=plugins/sdlc-pr-review  # one stage
```

Invoke a skill with `/sdlc-<stage>:<skill>`, e.g. `/sdlc-testing:flaky-test-triage`. The root `AGENTS.md` also tells Devin to pick the matching stage skill automatically.

## Run the MCP server

```bash
npm install && npm run build
npm start            # stdio
npm run start:http   # HTTP: MCP at /mcp, launcher UI at /, JSON API at /api/*  (also GET /healthz)
```

Or without cloning: `npx -y github:marcel-tan/sdlc-skills-marketplace`.

## Launcher UI

`npm run start:http` (or `sdlc-skills-mcp --http`) also serves a web UI at `http://127.0.0.1:3333/` for launching Devin as an agent with a chosen set of skills:

1. Describe the task (plus optional repo, context, title, ACU cap) and click **Recommend skills**.
2. Tick/reorder skills — the top two recommendations are preselected; click a skill name to read its `SKILL.md`.
3. Review the composed prompt, then **Launch Devin session** (needs `DEVIN_API_KEY`) or **Dry run** to see the request without spending credits.

Launched sessions are listed at the bottom with live status (polled from the Devin API every 15s) and PR links once Devin opens one. If `MCP_AUTH_TOKEN` is set, paste it in the top-right field; the UI keeps it in `sessionStorage` (per tab, gone when the tab closes) and sends it as a bearer token on every `/api/*` call. Pass `--no-ui` to serve only `/mcp`.

The UI is plain HTML/JS in `web/` talking to these routes (all JSON, same auth as `/mcp`):

| Route | Purpose |
| --- | --- |
| `GET /api/config` | Whether Devin is configured (`v1`/`v3` endpoint), whether auth is required, stage list. |
| `GET /api/skills`, `GET /api/skills/:plugin/:name` | Skill summaries; one skill with body and hand-off chain. |
| `POST /api/recommend` `{task, limit}` | Ranked skills + suggested chain. |
| `POST /api/compose` `{task, skillIds, repo, context, mode}` | Composed prompt. |
| `POST /api/sessions` `{task, skillIds, repo, context, mode, title, tags, maxAcuLimit, dryRun}` | Create a Devin session (or return the request when `dryRun`). |
| `GET /api/sessions`, `GET /api/sessions/:id` | Sessions launched by this process; live status of one of them (404 for any other session ID). |

| Variable | Purpose |
| --- | --- |
| `DEVIN_API_KEY` | Required for `start_devin_session`. Service-user key from Devin → Settings → API. |
| `DEVIN_ORG_ID` | Optional. When set, sessions are created via `POST /v3/organizations/{org}/sessions`; otherwise `POST /v1/sessions`. |
| `DEVIN_API_BASE_URL` | Optional, defaults to `https://api.devin.ai`. |
| `MCP_AUTH_TOKEN` | HTTP mode: callers must send `Authorization: Bearer <token>` on `/mcp` and `/api/*`. Required when binding a non-loopback host with `DEVIN_API_KEY` set, since launching sessions spends credits. |
| `PORT` / `--port`, `--host` | HTTP transport bind. Use `--host 0.0.0.0` in containers (with `MCP_AUTH_TOKEN`). |
| `SDLC_SKILLS_ROOT` / `--root` | Load skills from a different checkout (e.g. a fork with extra plugins). |

Register it in Devin → Settings → Connections → MCP servers:

- **stdio**: command `npx`, args `-y github:marcel-tan/sdlc-skills-marketplace`, env `DEVIN_API_KEY` (optional).
- **HTTP**: URL `http://<host>:3333/mcp` for a deployed instance.

### Tools

| Tool | What it does |
| --- | --- |
| `list_stages` | Stages in pipeline order with their plugin and skills. |
| `list_skills` | Skill metadata, filterable by `stage`, `tag`, or `query`. |
| `get_skill` | Full `SKILL.md` body plus the hand-off chain for one skill. |
| `recommend_skills` | Rank skills for a free-text task with scores and reasons; returns a suggested chain. |
| `compose_session_prompt` | Task + chosen skills → ready-to-send Devin prompt (`inline` embeds bodies; `reference` names installed plugin skills). |
| `start_devin_session` | Compose and create a Devin session; `dry_run: true` returns the request instead. Tags sessions with `sdlc-skills` and the stage ids. |

Resources: `sdlc-skills://catalog` (JSON index) and `sdlc-skill://<plugin>/<skill>` (markdown body).

Typical flow from another Devin session:

```text
recommend_skills(task="the checkout e2e test is flaky in CI")
  → sdlc-testing:flaky-test-triage (35), sdlc-testing:e2e-from-acceptance-criteria (26)
start_devin_session(task=..., skill_ids=["sdlc-testing:flaky-test-triage"], repo="github.com/acme/shop")
  → { sessionId, url }
```

## Add or change a skill

1. Create `plugins/sdlc-<stage>/skills/<name>/SKILL.md` with frontmatter (`name` must equal the folder; `metadata.stage` must be the plugin's stage; `metadata.next` must reference existing `plugin:skill` ids).
2. `npm run catalog` to regenerate `catalog.json`.
3. `npm run check` — lint, build, validate (manifests, frontmatter, hand-off graph, catalog freshness) and tests. CI runs the same.

## Layout

```text
.devin-plugin/plugin.json   meta-plugin requiring the six stage plugins
AGENTS.md                   always-on rule: pick the stage skill for the task
plugins/sdlc-*/             one Devin plugin per stage, skills/<name>/SKILL.md
catalog.json                generated index (npm run catalog)
mcp-server/src/             catalog loader, recommender, prompt composer, Devin API client, MCP server, JSON API, CLI
mcp-server/test/            vitest suites (catalog validation, ranking, MCP tools over in-memory transport, JSON API)
web/                        launcher UI (static HTML/CSS/JS served by --http)
scripts/                    build-catalog.mjs, validate.mjs
```
