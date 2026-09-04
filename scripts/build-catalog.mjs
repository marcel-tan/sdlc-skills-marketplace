#!/usr/bin/env node
// Regenerates catalog.json from plugins/**/SKILL.md. Run `npm run catalog` after editing skills.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCatalog, summarize } from "../mcp-server/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const catalog = await loadCatalog(root);
const json = JSON.stringify(summarize(catalog), null, 2) + "\n";
const target = resolve(root, "catalog.json");

if (check) {
  const { readFile } = await import("node:fs/promises");
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== json) {
    console.error("catalog.json is stale; run `npm run catalog`");
    process.exit(1);
  }
  console.log("catalog.json is up to date");
} else {
  await writeFile(target, json);
  console.log(`wrote catalog.json (${catalog.skills.length} skills, ${catalog.plugins.length} plugins)`);
}
