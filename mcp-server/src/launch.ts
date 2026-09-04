import { findSkill, type Catalog, type Skill } from "./catalog.js";
import type { CreateSessionInput } from "./devin.js";
import { composeSessionPrompt } from "./prompt.js";
import { recommendSkills } from "./recommend.js";

export const DEFAULT_RECOMMENDATIONS = 2;

export function resolveSkills(catalog: Catalog, ids: string[]): { skills: Skill[]; missing: string[] } {
  const skills: Skill[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const s = findSkill(catalog, id);
    if (s) {
      if (!skills.includes(s)) skills.push(s);
    } else missing.push(id);
  }
  return { skills, missing };
}

export interface LaunchOptions {
  task: string;
  skillIds?: string[] | undefined;
  repo?: string | undefined;
  context?: string | undefined;
  mode?: "inline" | "reference" | undefined;
  title?: string | undefined;
  tags?: string[] | undefined;
  playbookId?: string | undefined;
  maxAcuLimit?: number | undefined;
  unlisted?: boolean | undefined;
  idempotent?: boolean | undefined;
  createAsUserId?: string | undefined;
  marketplaceUrl?: string | undefined;
}

export interface LaunchPlan {
  skills: Skill[];
  skillIds: string[];
  prompt: string;
  request: CreateSessionInput;
}

export class UnknownSkillError extends Error {
  constructor(readonly missing: string[]) {
    super(`Unknown skill id(s): ${missing.join(", ")}`);
  }
}

/** Resolve skills (or recommend them), compose the prompt, and build the Devin create-session request. */
export function planLaunch(catalog: Catalog, opts: LaunchOptions): LaunchPlan {
  const ids = opts.skillIds ?? recommendSkills(catalog, opts.task, DEFAULT_RECOMMENDATIONS).map((r) => r.id);
  const { skills, missing } = resolveSkills(catalog, ids);
  if (missing.length > 0) throw new UnknownSkillError(missing);
  const prompt = composeSessionPrompt({
    task: opts.task,
    skills,
    repo: opts.repo,
    context: opts.context,
    mode: opts.mode,
    marketplaceUrl: opts.marketplaceUrl,
  });
  const stages = [...new Set(skills.map((s) => s.stage))];
  const tags = [...new Set(["sdlc-skills", ...stages, ...(opts.tags ?? [])])];
  return {
    skills,
    skillIds: skills.map((s) => s.id),
    prompt,
    request: {
      prompt,
      title: opts.title,
      tags,
      playbookId: opts.playbookId,
      maxAcuLimit: opts.maxAcuLimit,
      unlisted: opts.unlisted,
      idempotent: opts.idempotent,
      createAsUserId: opts.createAsUserId,
    },
  };
}
