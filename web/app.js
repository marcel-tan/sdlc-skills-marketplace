// SDLC Skills Launcher — vanilla JS client for the /api/* routes served by `sdlc-skills-mcp --http`.

const TOKEN_KEY = "sdlc.authToken";
const SESSIONS_KEY = "sdlc.sessions";
const POLL_MS = 15000;

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
};

const state = {
  config: null,
  skills: [],
  stages: [],
  selected: [], // ordered skill ids
  autoSelected: new Set(), // subset of `selected` added by recommend(), replaced on the next recommend()
  recommendations: new Map(), // id -> recommendation
  sessions: loadSessions(),
  statuses: new Map(), // sessionId -> SessionStatus
  composeTimer: null,
  recommendSeq: 0,
  composeSeq: 0,
  pollOffset: 0,
  launching: false,
};

// ---------- API ----------

// Token lives in sessionStorage: per-tab and cleared when the tab closes.
function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function authHeaders() {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function api(path, init = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (res.status === 401) {
    showTokenForm(true);
    throw new ApiError(401, "Unauthorized: enter the MCP_AUTH_TOKEN in the top-right field.", data);
  }
  if (!res.ok) throw new ApiError(res.status, (data && (data.error?.message || data.error)) || `HTTP ${res.status}`, data);
  return data;
}

class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// ---------- persistence ----------

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions() {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(state.sessions.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

// ---------- boot ----------

async function boot() {
  wireEvents();
  try {
    state.config = await api("/api/config");
  } catch (err) {
    setDevinPill("err", err.status === 401 ? "Auth token required" : "Server unreachable");
    if (err.status !== 401) console.error(err);
    return;
  }
  showTokenForm(state.config.authRequired);
  state.stages = state.config.stages;
  setDevinPill(
    state.config.devinConfigured ? "ok" : "warn",
    state.config.devinConfigured ? `Devin API ready (${state.config.devinEndpoint})` : "DEVIN_API_KEY not set — dry runs only",
  );
  const { skills } = await api("/api/skills");
  state.skills = skills;
  renderCatalog();
  updateLaunchButtons();
  await mergeServerSessions();
  renderSessions();
  pollStatuses();
  setInterval(pollStatuses, POLL_MS);
}

function setDevinPill(kind, text) {
  const pill = $("devin-pill");
  pill.dataset.state = kind;
  pill.textContent = text;
}

function showTokenForm(show) {
  $("token-form").classList.toggle("hidden", !show);
  if (show) $("token-input").value = getToken() || "";
}

// ---------- events ----------

function wireEvents() {
  $("token-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("token-input").value.trim();
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  $("recommend-btn").addEventListener("click", recommend);
  $("task").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") recommend();
  });
  for (const id of ["task", "repo", "context", "mode"]) $(id).addEventListener("input", scheduleCompose);

  for (const chip of document.querySelectorAll(".chip.example")) {
    chip.addEventListener("click", () => {
      $("task").value = chip.dataset.task;
      recommend();
    });
  }

  $("copy-btn").addEventListener("click", async () => {
    const text = $("prompt").textContent;
    try {
      await navigator.clipboard.writeText(text);
      flash("copy-btn", "Copied");
    } catch {
      flash("copy-btn", "Copy failed");
    }
  });

  $("launch-btn").addEventListener("click", () => launch(false));
  $("dryrun-btn").addEventListener("click", () => launch(true));
  $("refresh-btn").addEventListener("click", pollStatuses);

  $("drawer-close").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
}

function flash(id, text) {
  const btn = $(id);
  const prev = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = prev), 1200);
}

// ---------- recommend ----------

async function recommend() {
  const task = $("task").value.trim();
  const hint = $("recommend-hint");
  hint.classList.remove("error");
  if (task.length < 3) {
    hint.textContent = "Describe the task first (3+ characters).";
    hint.classList.add("error");
    return;
  }
  hint.textContent = "Thinking…";
  const seq = ++state.recommendSeq;
  try {
    const { recommendations, suggestedChain } = await api("/api/recommend", { method: "POST", body: JSON.stringify({ task, limit: 5 }) });
    if (seq !== state.recommendSeq) return;
    state.recommendations = new Map(recommendations.map((r) => [r.id, r]));
    // Preselect the top two (same default as the MCP tool); previous auto-picks are replaced, manual picks kept.
    const top = recommendations.slice(0, 2).map((r) => r.id);
    const manual = state.selected.filter((id) => !state.autoSelected.has(id));
    state.selected = [...new Set([...top, ...manual])];
    state.autoSelected = new Set(top.filter((id) => !manual.includes(id)));
    hint.textContent = recommendations.length
      ? `${recommendations.length} match${recommendations.length === 1 ? "" : "es"} · suggested chain: ${suggestedChain.join(" → ")}`
      : "No skill matched — pick skills manually or rephrase the task.";
    renderCatalog();
    scheduleCompose();
  } catch (err) {
    if (seq !== state.recommendSeq) return;
    hint.textContent = err.message;
    hint.classList.add("error");
  }
}

// ---------- catalog / selection ----------

function renderCatalog() {
  const root = $("catalog");
  root.replaceChildren();
  const recommendedStages = new Set([...state.recommendations.values()].map((r) => r.stage));
  for (const stage of state.stages) {
    const skills = state.skills.filter((s) => s.stage === stage.id);
    if (skills.length === 0) continue;
    const open = recommendedStages.size === 0 || recommendedStages.has(stage.id) || skills.some((s) => state.selected.includes(s.id));
    const group = el(
      "details",
      { class: "stage-group", open },
      el("summary", {}, stage.title, el("span", { class: "n" }, `${skills.length} skills`)),
      ...skills
        .slice()
        .sort((a, b) => (state.recommendations.get(b.id)?.score ?? 0) - (state.recommendations.get(a.id)?.score ?? 0) || a.id.localeCompare(b.id))
        .map(renderSkillRow),
    );
    root.append(group);
  }
  renderSelected();
}

function renderSkillRow(skill) {
  const rec = state.recommendations.get(skill.id);
  const checked = state.selected.includes(skill.id);
  const checkbox = el("input", {
    type: "checkbox",
    checked,
    "aria-label": `Select ${skill.id}`,
    onchange: (e) => toggleSkill(skill.id, e.target.checked),
  });
  return el(
    "div",
    { class: `skill${rec ? " recommended" : ""}`, dataset: { id: skill.id } },
    checkbox,
    el(
      "div",
      {},
      el("span", { class: "name", onclick: () => openDrawer(skill.id), title: "Show SKILL.md" }, skill.id),
      el("div", { class: "desc" }, skill.description),
      rec ? el("div", { class: "reason" }, rec.reasons.join(" · ")) : null,
      el("div", { class: "tags" }, ...skill.tags.slice(0, 6).map((t) => el("span", {}, t))),
    ),
    rec ? el("span", { class: "chip score", title: "Relevance score" }, rec.score.toFixed(1)) : el("span"),
  );
}

function toggleSkill(id, on) {
  if (on && !state.selected.includes(id)) state.selected.push(id);
  if (!on) state.selected = state.selected.filter((x) => x !== id);
  state.autoSelected.delete(id);
  renderSelected();
  scheduleCompose();
}

function moveSkill(id, delta) {
  const i = state.selected.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.selected.length) return;
  [state.selected[i], state.selected[j]] = [state.selected[j], state.selected[i]];
  renderSelected();
  scheduleCompose();
}

function renderSelected() {
  const list = $("selected-list");
  list.replaceChildren(
    ...state.selected.map((id, i) =>
      el(
        "div",
        { class: "selected-item" },
        el("span", { class: "order" }, `${i + 1}.`),
        el("code", { title: id }, id),
        el("button", { class: "icon-btn", type: "button", title: "Move up", disabled: i === 0, onclick: () => moveSkill(id, -1) }, "↑"),
        el("button", { class: "icon-btn", type: "button", title: "Move down", disabled: i === state.selected.length - 1, onclick: () => moveSkill(id, 1) }, "↓"),
        el("button", { class: "icon-btn", type: "button", title: "Remove", onclick: () => toggleSkill(id, false) }, "✕"),
      ),
    ),
  );
  $("selected-count").textContent = `${state.selected.length} selected`;
  for (const row of document.querySelectorAll(".skill")) {
    const box = row.querySelector("input");
    box.checked = state.selected.includes(row.dataset.id);
  }
  updateLaunchButtons();
}

// ---------- compose ----------

function launchPayload(extra = {}) {
  const num = $("max-acu").value ? Number($("max-acu").value) : undefined;
  return {
    task: $("task").value.trim(),
    skillIds: state.selected,
    repo: $("repo").value.trim() || undefined,
    context: $("context").value.trim() || undefined,
    mode: $("mode").value,
    title: $("title").value.trim() || undefined,
    maxAcuLimit: Number.isInteger(num) && num > 0 ? num : undefined,
    ...extra,
  };
}

function scheduleCompose() {
  clearTimeout(state.composeTimer);
  state.composeTimer = setTimeout(compose, 250);
}

async function compose() {
  const meta = $("prompt-meta");
  const pre = $("prompt");
  const payload = launchPayload();
  if (payload.task.length < 3 || state.selected.length === 0) {
    pre.textContent = state.selected.length === 0 ? "Select at least one skill to preview the prompt." : "Describe the task to preview the prompt.";
    meta.textContent = "Prompt preview";
    return;
  }
  const seq = ++state.composeSeq;
  try {
    const { prompt } = await api("/api/compose", { method: "POST", body: JSON.stringify({ task: payload.task, skillIds: payload.skillIds, repo: payload.repo, context: payload.context, mode: payload.mode }) });
    if (seq !== state.composeSeq) return;
    pre.textContent = prompt;
    meta.textContent = `Prompt preview · ${prompt.length.toLocaleString()} chars · ${payload.skillIds.length} skill${payload.skillIds.length === 1 ? "" : "s"} (${payload.mode})`;
  } catch (err) {
    if (seq !== state.composeSeq) return;
    pre.textContent = err.message;
    meta.textContent = "Prompt preview · error";
  }
}

function updateLaunchButtons() {
  const ready = state.selected.length > 0 && $("task").value.trim().length >= 3 && !state.launching;
  $("dryrun-btn").disabled = !ready;
  const configured = Boolean(state.config?.devinConfigured);
  $("launch-btn").disabled = !ready || !configured;
  $("launch-hint").textContent = !configured
    ? "Set DEVIN_API_KEY on the server to enable launching."
    : ready
      ? "Creates a real Devin session (spends ACUs)."
      : "Describe the task and pick at least one skill.";
}

$("task").addEventListener("input", updateLaunchButtons);

// ---------- launch ----------

async function launch(dryRun) {
  if (state.launching) return;
  const result = $("launch-result");
  const btn = dryRun ? $("dryrun-btn") : $("launch-btn");
  const label = btn.textContent;
  state.launching = true;
  updateLaunchButtons();
  btn.textContent = dryRun ? "Composing…" : "Launching…";
  result.className = "result";
  result.textContent = "";
  try {
    const data = await api("/api/sessions", { method: "POST", body: JSON.stringify(launchPayload({ dryRun })) });
    if (dryRun) {
      result.classList.add("ok");
      result.append(
        el("strong", {}, "Dry run — request that would be sent to the Devin API:"),
        el("pre", {}, JSON.stringify({ ...data.request, prompt: `${data.request.prompt.slice(0, 400)}… (${data.request.prompt.length} chars)` }, null, 2)),
      );
    } else {
      result.classList.add("ok");
      result.append(
        el("strong", {}, data.isNewSession === false ? "Reused existing session: " : "Session started: "),
        el("a", { href: data.url, target: "_blank", rel: "noopener" }, data.url),
        el("div", { class: "hint" }, `${data.sessionId} · skills: ${data.skillIds.join(", ")}`),
      );
      state.sessions.unshift(data);
      if (!saveSessions()) result.append(el("div", { class: "hint" }, "Could not persist to browser storage; the session is still listed below until you reload."));
      renderSessions();
      pollStatuses();
    }
  } catch (err) {
    result.classList.add("err");
    result.append(el("strong", {}, `Failed (${err.status || "network"}): `), err.message);
    const upstream = err.data?.upstreamBody;
    if (upstream) result.append(el("pre", {}, upstream));
  } finally {
    result.classList.remove("hidden");
    btn.textContent = label;
    state.launching = false;
    updateLaunchButtons();
  }
}

// ---------- sessions ----------

async function mergeServerSessions() {
  try {
    const { sessions } = await api("/api/sessions");
    const known = new Set(state.sessions.map((s) => s.sessionId));
    for (const s of sessions) if (!known.has(s.sessionId)) state.sessions.push(s);
    state.sessions.sort((a, b) => (b.launchedAt || "").localeCompare(a.launchedAt || ""));
    saveSessions();
  } catch {
    // server list is best-effort; localStorage still has this browser's launches
  }
}

const POLL_BATCH = 20;

async function pollStatuses() {
  if (!state.config?.devinConfigured) return;
  const active = state.sessions.filter((s) => {
    const st = state.statuses.get(s.sessionId);
    return !st || st.state === "running" || st.state === "blocked" || st.state === "unknown";
  });
  if (active.length === 0) return;
  // Rotate through active sessions so none starve when there are more than one batch's worth.
  const start = state.pollOffset % active.length;
  const batch = [...active.slice(start), ...active.slice(0, start)].slice(0, POLL_BATCH);
  state.pollOffset = start + batch.length;
  await Promise.all(
    batch.map(async (s) => {
      try {
        state.statuses.set(s.sessionId, await api(`/api/sessions/${encodeURIComponent(s.sessionId)}`));
      } catch (err) {
        // 404 = launched by an earlier server process; it can't be polled but the link still works.
        const stale = err.status === 404;
        state.statuses.set(s.sessionId, { state: stale ? "stale" : "unknown", status: stale ? "not tracked by this server" : err.message, pullRequests: [] });
      }
    }),
  );
  renderSessions();
}

function renderSessions() {
  const body = $("sessions-body");
  if (state.sessions.length === 0) {
    body.replaceChildren(el("tr", { class: "empty" }, el("td", { colspan: 5 }, "No sessions yet.")));
    return;
  }
  body.replaceChildren(
    ...state.sessions.map((s) => {
      const st = state.statuses.get(s.sessionId);
      const stateName = st?.state || "unknown";
      const label = st ? st.status : state.config?.devinConfigured ? "checking…" : "status unavailable";
      return el(
        "tr",
        {},
        el("td", {}, el("span", { class: "badge", dataset: { state: stateName }, title: st?.updatedAt || "" }, label)),
        el("td", {}, el("div", {}, s.title || st?.title || s.task), s.repo ? el("div", { class: "hint" }, s.repo) : null),
        el("td", { class: "skills-cell" }, ...(s.skillIds || []).map((id) => el("code", {}, id))),
        el("td", {}, s.launchedAt ? new Date(s.launchedAt).toLocaleString() : "—"),
        el(
          "td",
          {},
          el("a", { href: s.url, target: "_blank", rel: "noopener" }, "Open session"),
          ...(st?.pullRequests || []).map((url) => el("div", {}, el("a", { href: url, target: "_blank", rel: "noopener" }, url.replace(/^https?:\/\//, "")))),
          " ",
          el("button", { class: "icon-btn", type: "button", title: "Forget this session (does not stop it)", onclick: () => forgetSession(s.sessionId) }, "✕"),
        ),
      );
    }),
  );
}

function forgetSession(id) {
  state.sessions = state.sessions.filter((s) => s.sessionId !== id);
  state.statuses.delete(id);
  saveSessions();
  renderSessions();
}

// ---------- drawer ----------

async function openDrawer(id) {
  const skill = state.skills.find((s) => s.id === id);
  if (!skill) return;
  $("drawer-title").textContent = skill.id;
  $("drawer-body").textContent = "Loading…";
  $("drawer-meta").replaceChildren(
    el("span", { class: "chip stage" }, skill.stage),
    ...skill.tags.map((t) => el("span", { class: "chip" }, t)),
    skill.next?.length ? el("span", { class: "chip" }, `next: ${skill.next.join(", ")}`) : null,
  );
  $("drawer").classList.remove("hidden");
  $("drawer").setAttribute("aria-hidden", "false");
  $("scrim").classList.remove("hidden");
  try {
    const full = await api(`/api/skills/${encodeURIComponent(skill.plugin)}/${encodeURIComponent(skill.name)}`);
    $("drawer-body").textContent = full.body;
  } catch (err) {
    $("drawer-body").textContent = err.message;
  }
}

function closeDrawer() {
  $("drawer").classList.add("hidden");
  $("drawer").setAttribute("aria-hidden", "true");
  $("scrim").classList.add("hidden");
}

boot();
