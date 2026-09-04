import type { Catalog, Skill } from "./catalog.js";
import { stageById } from "./stages.js";

export interface Recommendation {
  id: string;
  stage: string;
  description: string;
  score: number;
  /** Human-readable reasons, e.g. `tag "flaky"`, `stage keyword "pull request"`. */
  reasons: string[];
  next: string[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with", "from", "into",
  "is", "are", "be", "this", "that", "it", "its", "as", "we", "i", "you", "our", "my", "your",
  "please", "can", "could", "should", "would", "need", "needs", "want", "make", "some", "all",
  "up", "out", "then", "so", "do", "does", "did", "not", "no", "yes", "use", "using", "when",
]);

export function stem(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ied")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith("es") && !t.endsWith("ses")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

function normalizePhrase(text: string): string {
  return ` ${tokenize(text).join(" ")} `;
}

const WEIGHTS = { name: 6, tag: 4, stageKeyword: 3, description: 2, body: 0.5, bodyCap: 3 } as const;

interface Indexed {
  skill: Skill;
  name: Set<string>;
  tags: Map<string, string>; // stemmed phrase -> original tag
  description: Set<string>;
  body: Set<string>;
  stageKeywords: Map<string, string>; // stemmed phrase -> original keyword
}

function index(skill: Skill): Indexed {
  const stage = stageById(skill.stage);
  return {
    skill,
    name: new Set(tokenize(skill.name)),
    tags: new Map(skill.tags.map((t) => [normalizePhrase(t), t])),
    description: new Set(tokenize(skill.description)),
    body: new Set(tokenize(skill.body)),
    stageKeywords: new Map((stage?.keywords ?? []).map((k) => [normalizePhrase(k), k])),
  };
}

export function scoreSkill(entry: Indexed, task: string): { score: number; reasons: string[] } {
  const tokens = tokenize(task);
  const unique = [...new Set(tokens)];
  const phrase = ` ${tokens.join(" ")} `;
  let score = 0;
  const reasons: string[] = [];

  for (const t of unique) {
    if (entry.name.has(t)) {
      score += WEIGHTS.name;
      reasons.push(`name "${t}"`);
    }
  }
  for (const [stemmed, original] of entry.tags) {
    if (phrase.includes(stemmed)) {
      score += WEIGHTS.tag;
      reasons.push(`tag "${original}"`);
    }
  }
  for (const [stemmed, original] of entry.stageKeywords) {
    if (phrase.includes(stemmed)) {
      score += WEIGHTS.stageKeyword;
      reasons.push(`stage keyword "${original}"`);
    }
  }
  const descHits = unique.filter((t) => entry.description.has(t));
  if (descHits.length > 0) {
    score += WEIGHTS.description * descHits.length;
    reasons.push(`description mentions ${descHits.map((t) => `"${t}"`).join(", ")}`);
  }
  const bodyHits = unique.filter((t) => entry.body.has(t) && !entry.description.has(t) && !entry.name.has(t));
  if (bodyHits.length > 0) {
    score += Math.min(WEIGHTS.bodyCap, WEIGHTS.body * bodyHits.length);
  }
  return { score: Math.round(score * 100) / 100, reasons };
}

export function recommendSkills(catalog: Catalog, task: string, limit = 3): Recommendation[] {
  const scored = catalog.skills
    .map((skill) => ({ skill, ...scoreSkill(index(skill), task) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

  return scored.slice(0, Math.max(1, limit)).map(({ skill, score, reasons }) => ({
    id: skill.id,
    stage: skill.stage,
    description: skill.description,
    score,
    reasons,
    next: skill.next,
  }));
}

/** Follow `next` links from a starting skill to produce the suggested hand-off chain (no repeats). */
export function handoffChain(catalog: Catalog, startId: string, maxLength = 6): string[] {
  const byId = new Map(catalog.skills.map((s) => [s.id, s]));
  const chain: string[] = [];
  let current = byId.get(startId);
  while (current && chain.length < maxLength && !chain.includes(current.id)) {
    chain.push(current.id);
    const nextId = current.next.find((n) => !chain.includes(n));
    current = nextId ? byId.get(nextId) : undefined;
  }
  return chain;
}
