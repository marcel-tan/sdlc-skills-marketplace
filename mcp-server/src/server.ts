import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSkill, summarize, type Catalog, type Skill } from "./catalog.js";
import { createDevinSession, devinConfigFromEnv, type DevinConfig } from "./devin.js";
import { planLaunch, UnknownSkillError } from "./launch.js";
import { handoffChain, recommendSkills } from "./recommend.js";
import { STAGES, STAGE_ORDER } from "./stages.js";

export interface ServerDeps {
  catalog: Catalog;
  devin?: DevinConfig | undefined;
  fetchImpl?: ((input: string, init: RequestInit) => Promise<Response>) | undefined;
  marketplaceUrl?: string | undefined;
}

export const SERVER_INFO = { name: "sdlc-skills-marketplace", version: "0.1.0" } as const;

const SKILL_URI_PREFIX = "sdlc-skill://";

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function skillSummary(s: Skill) {
  const { body: _body, ...rest } = s;
  return rest;
}

export function createServer(deps: ServerDeps): McpServer {
  const { catalog } = deps;
  const devin = deps.devin ?? devinConfigFromEnv();
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "SDLC skills marketplace. Call recommend_skills with the task description to find the right skills, " +
      "compose_session_prompt to build a Devin prompt that embeds them, and start_devin_session to run it.",
  });

  server.registerTool(
    "list_stages",
    {
      title: "List SDLC stages",
      description: "List the SDLC stages in pipeline order (specs → stories → codegen → testing → pr-review → code-hygiene) with the plugin and skills for each.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      text(
        STAGES.map((st) => ({
          id: st.id,
          title: st.title,
          plugin: st.plugin,
          summary: st.summary,
          skills: catalog.skills.filter((s) => s.stage === st.id).map((s) => s.id),
        })),
      ),
  );

  server.registerTool(
    "list_skills",
    {
      title: "List skills",
      description: "List available SDLC skills with stage, description, tags, inputs, outputs and hand-offs. Filter by stage, tag, or free-text query.",
      inputSchema: {
        stage: z.enum(STAGE_ORDER as [string, ...string[]]).optional().describe("Only skills in this stage"),
        tag: z.string().optional().describe("Only skills carrying this tag"),
        query: z.string().optional().describe("Case-insensitive substring match on id, description, or tags"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ stage, tag, query }) => {
      const q = query?.toLowerCase();
      const result = catalog.skills
        .filter((s) => !stage || s.stage === stage)
        .filter((s) => !tag || s.tags.includes(tag))
        .filter((s) => !q || s.id.includes(q) || s.description.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)))
        .map(skillSummary);
      return text(result);
    },
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get skill",
      description: "Return a skill's full SKILL.md instructions plus metadata. Accepts `plugin:skill` (e.g. `sdlc-testing:flaky-test-triage`) or just the skill name.",
      inputSchema: { id: z.string().describe("Skill id such as `sdlc-codegen:implement-story`") },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const s = findSkill(catalog, id);
      if (!s) return { ...text(`Unknown skill "${id}". Known: ${catalog.skills.map((k) => k.id).join(", ")}`), isError: true };
      return text({ ...skillSummary(s), body: s.body, handoffChain: handoffChain(catalog, s.id) });
    },
  );

  server.registerTool(
    "recommend_skills",
    {
      title: "Recommend skills for a task",
      description:
        "Given a free-text task description, rank the SDLC skills most relevant to it with scores and reasons, and suggest the hand-off chain to follow. Use this first to decide which skills a Devin session should run.",
      inputSchema: {
        task: z.string().min(3).describe("What needs to be done, e.g. 'review PR #42 for security issues'"),
        limit: z.number().int().min(1).max(10).default(3).describe("Max number of skills to return"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ task, limit }) => {
      const recommendations = recommendSkills(catalog, task, limit);
      const top = recommendations[0];
      return text({
        task,
        recommendations,
        suggestedChain: top ? handoffChain(catalog, top.id) : [],
        note: recommendations.length === 0 ? "No skill matched; the task may fall outside the SDLC stages covered by this marketplace." : undefined,
      });
    },
  );

  server.registerTool(
    "compose_session_prompt",
    {
      title: "Compose a Devin session prompt",
      description:
        "Build a ready-to-send Devin prompt that combines the task with the chosen skills (inline SKILL.md bodies by default). If skill_ids is omitted, the top recommendations for the task are used.",
      inputSchema: {
        task: z.string().min(3).describe("The task for the session"),
        skill_ids: z.array(z.string()).optional().describe("Skills to include, in order. Defaults to recommend_skills(task, 2)"),
        repo: z.string().optional().describe("Repository the session should work in, e.g. github.com/acme/api"),
        context: z.string().optional().describe("Extra context or constraints appended to the prompt"),
        mode: z.enum(["inline", "reference"]).default("inline").describe("inline = embed skill bodies; reference = name skills only (plugin already installed)"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ task, skill_ids, repo, context, mode }) => {
      try {
        const plan = planLaunch(catalog, { task, skillIds: skill_ids, repo, context, mode, marketplaceUrl: deps.marketplaceUrl });
        return text({ skillIds: plan.skillIds, prompt: plan.prompt });
      } catch (err) {
        if (err instanceof UnknownSkillError) return { ...text(err.message), isError: true };
        throw err;
      }
    },
  );

  server.registerTool(
    "start_devin_session",
    {
      title: "Start a Devin session with skills",
      description:
        "Create a Devin session whose prompt embeds the selected skills (or the top recommendations for the task). Requires DEVIN_API_KEY on the server; set DEVIN_ORG_ID to use the v3 organization endpoint. Returns the session id and URL.",
      inputSchema: {
        task: z.string().min(3).describe("The task for the session"),
        skill_ids: z.array(z.string()).optional().describe("Skills to include, in order. Defaults to recommend_skills(task, 2)"),
        repo: z.string().optional().describe("Repository the session should work in"),
        context: z.string().optional().describe("Extra context or constraints"),
        mode: z.enum(["inline", "reference"]).default("inline"),
        title: z.string().optional().describe("Session title"),
        tags: z.array(z.string()).optional().describe("Session tags; `sdlc-skills` and the stage ids are always added"),
        playbook_id: z.string().optional().describe("Optional Devin playbook id to attach"),
        max_acu_limit: z.number().int().positive().optional(),
        unlisted: z.boolean().optional(),
        idempotent: z.boolean().optional().describe("Reuse an existing session with the same prompt if one exists"),
        create_as_user_id: z.string().optional().describe("v3 only: attribute the session to this user"),
        dry_run: z.boolean().default(false).describe("Return the composed request without calling the Devin API"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      let plan;
      try {
        plan = planLaunch(catalog, {
          task: args.task,
          skillIds: args.skill_ids,
          repo: args.repo,
          context: args.context,
          mode: args.mode,
          title: args.title,
          tags: args.tags,
          playbookId: args.playbook_id,
          maxAcuLimit: args.max_acu_limit,
          unlisted: args.unlisted,
          idempotent: args.idempotent,
          createAsUserId: args.create_as_user_id,
          marketplaceUrl: deps.marketplaceUrl,
        });
      } catch (err) {
        if (err instanceof UnknownSkillError) return { ...text(err.message), isError: true };
        throw err;
      }

      if (args.dry_run) return text({ dryRun: true, skillIds: plan.skillIds, request: plan.request });
      if (!devin) {
        return {
          ...text("DEVIN_API_KEY is not configured on this MCP server. Set DEVIN_API_KEY (and optionally DEVIN_ORG_ID) or call with dry_run=true."),
          isError: true,
        };
      }
      const result = await createDevinSession(devin, plan.request, deps.fetchImpl);
      return text({ skillIds: plan.skillIds, ...result });
    },
  );

  server.registerResource(
    "catalog",
    "sdlc-skills://catalog",
    { title: "Skill catalog", description: "All plugins and skills with metadata (no bodies)", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(summarize(catalog), null, 2) }] }),
  );

  server.registerResource(
    "skill",
    new ResourceTemplate(`${SKILL_URI_PREFIX}{plugin}/{name}`, {
      list: async () => ({
        resources: catalog.skills.map((s) => ({
          uri: `${SKILL_URI_PREFIX}${s.plugin}/${s.name}`,
          name: s.id,
          description: s.description,
          mimeType: "text/markdown",
        })),
      }),
    }),
    { title: "SKILL.md", description: "Full SKILL.md for one skill", mimeType: "text/markdown" },
    async (uri, { plugin, name }) => {
      const s = findSkill(catalog, `${String(plugin)}:${String(name)}`);
      if (!s) throw new Error(`Unknown skill ${uri.href}`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: s.body }] };
    },
  );

  return server;
}
