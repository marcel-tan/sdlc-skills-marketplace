import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CatalogError, findSkill, loadCatalog, parseSkillFile, summarize } from "../src/catalog.js";
import { STAGE_ORDER } from "../src/stages.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

describe("loadCatalog (real marketplace)", () => {
  it("loads 6 plugins with skills in every stage, ordered by SDLC stage", async () => {
    const catalog = await loadCatalog(ROOT);
    expect(catalog.plugins.map((p) => p.stage)).toEqual([...STAGE_ORDER]);
    for (const stage of STAGE_ORDER) expect(catalog.skills.some((s) => s.stage === stage)).toBe(true);
    expect(catalog.skills.length).toBeGreaterThanOrEqual(18);
  });

  it("every next hand-off points at a known skill", async () => {
    const catalog = await loadCatalog(ROOT);
    const ids = new Set(catalog.skills.map((s) => s.id));
    for (const s of catalog.skills) for (const n of s.next) expect(ids.has(n), `${s.id} -> ${n}`).toBe(true);
  });

  it("findSkill accepts id, slash-prefixed id, bare name and path", async () => {
    const catalog = await loadCatalog(ROOT);
    const byId = findSkill(catalog, "sdlc-testing:flaky-test-triage");
    expect(byId?.name).toBe("flaky-test-triage");
    expect(findSkill(catalog, "/sdlc-testing:flaky-test-triage")).toBe(byId);
    expect(findSkill(catalog, "flaky-test-triage")).toBe(byId);
    expect(findSkill(catalog, byId!.path)).toBe(byId);
    expect(findSkill(catalog, "nope")).toBeUndefined();
  });

  it("summarize strips bodies", async () => {
    const catalog = await loadCatalog(ROOT);
    const summary = summarize(catalog);
    expect(summary.version).toBe(1);
    expect(summary.stages).toEqual([...STAGE_ORDER]);
    for (const s of summary.skills) expect(s).not.toHaveProperty("body");
  });
});

describe("loadCatalog (validation)", () => {
  async function fixture(skill: string, manifestName = "sdlc-specs"): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "sdlc-"));
    const plugin = join(root, "plugins", "sdlc-specs");
    await mkdir(join(plugin, ".devin-plugin"), { recursive: true });
    await mkdir(join(plugin, "skills", "write-prd"), { recursive: true });
    await writeFile(join(plugin, ".devin-plugin", "plugin.json"), JSON.stringify({ name: manifestName, version: "0.0.1", description: "x" }));
    await writeFile(join(plugin, "skills", "write-prd", "SKILL.md"), skill);
    return root;
  }

  const good = `---
name: write-prd
description: Use when writing a PRD.
metadata:
  stage: specs
  tags: [prd]
  next: []
---
# Write PRD
Steps.
`;

  it("accepts a minimal valid skill", async () => {
    const catalog = await loadCatalog(await fixture(good));
    expect(catalog.skills.map((s) => s.id)).toEqual(["sdlc-specs:write-prd"]);
    expect(catalog.skills[0]?.body).toBe("# Write PRD\nSteps.");
  });

  it("rejects a name that does not match the directory", async () => {
    await expect(loadCatalog(await fixture(good.replace("name: write-prd", "name: other")))).rejects.toThrow(CatalogError);
  });

  it("rejects an unknown stage", async () => {
    await expect(loadCatalog(await fixture(good.replace("stage: specs", "stage: nope")))).rejects.toThrow(/stage/);
  });

  it("rejects a dangling next reference", async () => {
    await expect(loadCatalog(await fixture(good.replace("next: []", "next: [sdlc-specs:missing]")))).rejects.toThrow(/missing/);
  });

  it("rejects a plugin manifest whose name does not match its folder", async () => {
    await expect(loadCatalog(await fixture(good, "wrong"))).rejects.toThrow(CatalogError);
  });

  it("parseSkillFile requires frontmatter", () => {
    expect(() => parseSkillFile("# no frontmatter", "x")).toThrow(/frontmatter/);
  });
});
