import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { STAGE_ORDER, stageByPlugin } from "./stages.js";

export interface Skill {
  /** `<plugin>:<name>`, e.g. `sdlc-specs:write-prd`. */
  id: string;
  plugin: string;
  name: string;
  stage: string;
  description: string;
  tags: string[];
  inputs: string[];
  outputs: string[];
  /** Skill ids to run after this one. */
  next: string[];
  /** Path to SKILL.md relative to the marketplace root. */
  path: string;
  /** Markdown body without frontmatter. */
  body: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
}

export interface Plugin extends PluginManifest {
  stage: string;
  path: string;
  skills: string[];
}

export interface Catalog {
  root: string;
  plugins: Plugin[];
  skills: Skill[];
}

interface Frontmatter {
  name?: unknown;
  description?: unknown;
  metadata?: {
    stage?: unknown;
    tags?: unknown;
    inputs?: unknown;
    outputs?: unknown;
    next?: unknown;
  };
}

export class CatalogError extends Error {}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseSkillFile(text: string, file: string): { fm: Frontmatter; body: string } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m || m[1] === undefined) throw new CatalogError(`${file}: missing YAML frontmatter`);
  const parsed: unknown = parseYaml(m[1]);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CatalogError(`${file}: frontmatter must be a mapping`);
  }
  return { fm: parsed as Frontmatter, body: text.slice(m[0].length).trim() };
}

function requireString(value: unknown, file: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogError(`${file}: frontmatter "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function stringList(value: unknown, file: string, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new CatalogError(`${file}: frontmatter "${field}" must be a list of strings`);
  }
  return value.map((v: string) => v.trim());
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readManifest(pluginDir: string, rel: string): Promise<PluginManifest> {
  const file = join(pluginDir, ".devin-plugin", "plugin.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new CatalogError(`${rel}: missing .devin-plugin/plugin.json`);
  }
  const json: unknown = JSON.parse(raw);
  if (json === null || typeof json !== "object") throw new CatalogError(`${rel}: plugin.json must be an object`);
  const o = json as Record<string, unknown>;
  return {
    name: requireString(o.name, `${rel}/plugin.json`, "name"),
    version: requireString(o.version, `${rel}/plugin.json`, "version"),
    description: requireString(o.description, `${rel}/plugin.json`, "description"),
  };
}

/** Load every plugin under `<root>/plugins` and every skill under `<plugin>/skills`. */
export async function loadCatalog(root: string): Promise<Catalog> {
  const pluginsDir = join(root, "plugins");
  if (!(await isDir(pluginsDir))) throw new CatalogError(`no plugins/ directory under ${root}`);

  const plugins: Plugin[] = [];
  const skills: Skill[] = [];

  for (const pluginName of (await readdir(pluginsDir)).sort()) {
    const pluginDir = join(pluginsDir, pluginName);
    if (!(await isDir(pluginDir))) continue;
    const relPlugin = relative(root, pluginDir);
    const manifest = await readManifest(pluginDir, relPlugin);
    if (manifest.name !== pluginName) {
      throw new CatalogError(`${relPlugin}: plugin.json name "${manifest.name}" must match folder "${pluginName}"`);
    }
    const stage = stageByPlugin(pluginName);
    if (!stage) throw new CatalogError(`${relPlugin}: no SDLC stage registered for plugin "${pluginName}" (see stages.ts)`);

    const skillsDir = join(pluginDir, "skills");
    const skillIds: string[] = [];
    if (await isDir(skillsDir)) {
      for (const skillName of (await readdir(skillsDir)).sort()) {
        const skillDir = join(skillsDir, skillName);
        if (!(await isDir(skillDir))) continue;
        const file = join(skillDir, "SKILL.md");
        const rel = relative(root, file);
        let text: string;
        try {
          text = await readFile(file, "utf8");
        } catch {
          throw new CatalogError(`${rel}: missing SKILL.md`);
        }
        const { fm, body } = parseSkillFile(text, rel);
        const name = requireString(fm.name, rel, "name");
        if (name !== skillName) throw new CatalogError(`${rel}: frontmatter name "${name}" must match folder "${skillName}"`);
        const meta = fm.metadata ?? {};
        const skillStage = typeof meta.stage === "string" ? meta.stage : stage.id;
        if (skillStage !== stage.id) {
          throw new CatalogError(`${rel}: metadata.stage "${skillStage}" does not match plugin stage "${stage.id}"`);
        }
        const id = `${pluginName}:${name}`;
        skills.push({
          id,
          plugin: pluginName,
          name,
          stage: stage.id,
          description: requireString(fm.description, rel, "description"),
          tags: stringList(meta.tags, rel, "metadata.tags"),
          inputs: stringList(meta.inputs, rel, "metadata.inputs"),
          outputs: stringList(meta.outputs, rel, "metadata.outputs"),
          next: stringList(meta.next, rel, "metadata.next"),
          path: rel,
          body,
        });
        skillIds.push(id);
      }
    }
    plugins.push({ ...manifest, stage: stage.id, path: relPlugin, skills: skillIds });
  }

  const ids = new Set(skills.map((s) => s.id));
  for (const s of skills) {
    for (const n of s.next) {
      if (!ids.has(n)) throw new CatalogError(`${s.path}: metadata.next references unknown skill "${n}"`);
    }
  }

  const order = new Map(STAGE_ORDER.map((id, i) => [id, i]));
  skills.sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99) || a.id.localeCompare(b.id));
  plugins.sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99));

  return { root, plugins, skills };
}

export function findSkill(catalog: Catalog, id: string): Skill | undefined {
  const needle = id.trim().replace(/^\//, "");
  return (
    catalog.skills.find((s) => s.id === needle) ??
    catalog.skills.find((s) => s.name === needle) ??
    catalog.skills.find((s) => s.path === needle)
  );
}

/** Shape of catalog.json — everything except skill bodies. */
export type CatalogSummary = {
  version: 1;
  stages: string[];
  plugins: Plugin[];
  skills: Omit<Skill, "body">[];
};

export function summarize(catalog: Catalog): CatalogSummary {
  return {
    version: 1,
    stages: [...STAGE_ORDER],
    plugins: catalog.plugins,
    skills: catalog.skills.map(({ body: _body, ...rest }) => rest),
  };
}
