import type { Skill } from "./catalog.js";

export interface ComposeOptions {
  task: string;
  skills: Skill[];
  /** Repository the session should work in, e.g. `github.com/acme/api`. */
  repo?: string | undefined;
  /** `inline` embeds each SKILL.md body; `reference` only names the skills (use when the plugin is already installed). */
  mode?: "inline" | "reference" | undefined;
  /** Extra constraints or context appended verbatim. */
  context?: string | undefined;
  marketplaceUrl?: string | undefined;
}

export function composeSessionPrompt(opts: ComposeOptions): string {
  const mode = opts.mode ?? "inline";
  const marketplace = opts.marketplaceUrl ?? "https://github.com/marcel-tan/sdlc-skills-marketplace";
  const lines: string[] = [];

  lines.push("# Task", "", opts.task.trim(), "");
  if (opts.repo) lines.push(`Repository: ${opts.repo}`, "");
  if (opts.context) lines.push("## Context", "", opts.context.trim(), "");

  if (opts.skills.length > 0) {
    lines.push(
      "## Skills to apply",
      "",
      `Follow these SDLC skills from ${marketplace}, in order. Each one ends with a hand-off naming the next skill; stop when the task is complete or the hand-off leaves the scope of the task.`,
      "",
    );
    for (const s of opts.skills) {
      lines.push(`- \`/${s.id}\` (${s.stage}) — ${s.description}`);
    }
    lines.push("");

    if (mode === "inline") {
      for (const s of opts.skills) {
        lines.push(`<skill id="${s.id}" path="${s.path}">`, s.body.trim(), "</skill>", "");
      }
    } else {
      lines.push(
        "The skills are installed as a Devin plugin; invoke each with its `/plugin:skill` name and follow its steps exactly.",
        "",
      );
    }
  }

  lines.push(
    "## Working agreement",
    "",
    "- Read the repository's AGENTS.md / CONTRIBUTING.md and run its lint and tests before opening a PR.",
    "- Prefer minimal, focused diffs; do not refactor outside the task's scope.",
    "- Report which skills you applied and any hand-off you did not follow, with the reason.",
  );

  return lines.join("\n").trimEnd() + "\n";
}
