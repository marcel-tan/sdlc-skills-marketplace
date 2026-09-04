---
name: create-tickets
description: Create epics and stories in the team's issue tracker (Jira, Linear, Azure Boards, or GitHub Issues) from a stories document, with dependencies, labels, and links back to the spec. Use when asked to file tickets, push stories to the backlog, or sync a plan into the tracker.
metadata:
  stage: stories
  tags: [tickets, jira, linear, azure-boards, github-issues, backlog]
  inputs: [stories document from spec-to-stories, tracker project/team key, spec URL]
  outputs: [created ticket IDs mapped to story IDs, epic link, tracker URL list]
  next: [sdlc-codegen:implement-story]
---

# Create tickets

Available as `/sdlc-stories:create-tickets`.

## Detect the tracker

Check which tracker integrations are available before doing anything, in this
order:

1. MCP servers exposed to the session (`atlassian`/Jira, `linear`, Azure
   DevOps, GitHub). Prefer MCP tools over the browser.
2. Repo hints: `.github/ISSUE_TEMPLATE/`, Jira keys in commit history
   (`ABC-123`), `linear.app` links in README/PRs, `dev.azure.com` remotes.
3. Ask the user only if none of the above resolves it.

## Steps

1. Load the stories document. Refuse to proceed if any story lacks
   acceptance criteria or a requirement trace — send it back through
   `/sdlc-stories:story-refinement` first.
2. Check for duplicates: search the tracker for each story title and for the
   spec URL. Update existing tickets rather than creating duplicates.
3. Create the epic (or parent issue/feature) first. Description = spec link +
   goal + out-of-scope list.
4. Create each story as a child of the epic, in dependency order. Map fields:

   | Story field | Jira | Linear | Azure Boards | GitHub Issues |
   |---|---|---|---|---|
   | Title | summary | title | title | title |
   | Body | description | description | description | body |
   | Estimate | story points | estimate | story points | label `size/N` |
   | Depends on | "is blocked by" link | blockedBy relation | Predecessor link | "Blocked by #N" in body |
   | Traces to | label `req/R2` | label | tag | label |
   | Epic | parent | project/parent | parent | milestone or tracking issue |

5. After all stories exist, add a comment to the epic with the ordered list
   of story IDs and the walking-skeleton story highlighted.
6. Post the mapping table (story ID → ticket ID → URL) back to the user and,
   if the spec lives in a PR/page, link the epic from it.

## Guardrails

- Never create tickets in a project the user did not name or that cannot be
  inferred from the repo. Confirm the project key once, then proceed.
- Do not assign tickets to people unless asked; leave them unassigned.
- One tracker write per story — do not retry blindly on failure; report the
  failed story IDs and continue with the rest.

## Hand-off

Each ticket is now an input for `/sdlc-codegen:implement-story`.
