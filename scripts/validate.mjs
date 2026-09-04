#!/usr/bin/env node
// Validates plugin manifests, SKILL.md frontmatter, stage metadata and hand-off links, then checks catalog.json is current.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCatalog, summarize, STAGE_ORDER } from "../mcp-server/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const errors = [];

let catalog;
try {
  catalog = await loadCatalog(root);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}

const rootManifest = JSON.parse(await readFile(resolve(root, ".devin-plugin/plugin.json"), "utf8"));
const required = new Set((rootManifest.requiredPlugins ?? []).map((p) => p.path));
for (const plugin of catalog.plugins) {
  if (!required.has(plugin.path)) errors.push(`root plugin.json does not require ${plugin.path}`);
}
for (const path of required) {
  if (!catalog.plugins.some((p) => p.path === path)) errors.push(`root plugin.json requires missing plugin ${path}`);
}

for (const stage of STAGE_ORDER) {
  if (!catalog.skills.some((s) => s.stage === stage)) errors.push(`stage "${stage}" has no skills`);
}

for (const skill of catalog.skills) {
  if (!/\bUse when\b/.test(skill.description)) errors.push(`${skill.id}: description must state a "Use when ..." trigger`);
  if (skill.description.length > 400) errors.push(`${skill.id}: description longer than 400 chars`);
  if (skill.tags.length === 0) errors.push(`${skill.id}: no tags`);
  if (!/^#\s/m.test(skill.body)) errors.push(`${skill.id}: body has no top-level heading`);
  if (!/hand-?off/i.test(skill.body)) errors.push(`${skill.id}: body has no hand-off section`);
  if (skill.next.length === 0 && skill.stage !== "code-hygiene") errors.push(`${skill.id}: no next hand-off`);
  for (const ref of skill.body.matchAll(/\/(sdlc-[a-z0-9-]+:[a-z0-9-]+)/g)) {
    if (!catalog.skills.some((s) => s.id === ref[1])) errors.push(`${skill.id}: body references unknown skill ${ref[1]}`);
  }
}

const expected = JSON.stringify(summarize(catalog), null, 2) + "\n";
const actual = await readFile(resolve(root, "catalog.json"), "utf8").catch(() => "");
if (actual !== expected) errors.push("catalog.json is stale; run `npm run catalog`");

if (errors.length > 0) {
  for (const e of errors) console.error(`✖ ${e}`);
  process.exit(1);
}
console.log(`✔ ${catalog.plugins.length} plugins, ${catalog.skills.length} skills valid; catalog.json current`);
