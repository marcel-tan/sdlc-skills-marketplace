export interface DevinConfig {
  apiKey: string;
  /** Defaults to https://api.devin.ai */
  baseUrl?: string | undefined;
  /** When set, sessions are created via `POST /v3/organizations/{orgId}/sessions`; otherwise `POST /v1/sessions`. */
  orgId?: string | undefined;
}

export interface CreateSessionInput {
  prompt: string;
  title?: string | undefined;
  tags?: string[] | undefined;
  playbookId?: string | undefined;
  maxAcuLimit?: number | undefined;
  unlisted?: boolean | undefined;
  idempotent?: boolean | undefined;
  /** v3 only: create the session on behalf of this user id. */
  createAsUserId?: string | undefined;
}

export interface CreateSessionResult {
  sessionId: string;
  url: string;
  isNewSession: boolean | null;
  endpoint: string;
}

export interface SessionStatus {
  sessionId: string;
  url: string;
  title: string | null;
  /** Coarse state normalised across v1/v3: running | blocked | finished | error | suspended | unknown */
  state: "running" | "blocked" | "finished" | "error" | "suspended" | "unknown";
  /** Raw status (+ detail) as returned by the API. */
  status: string;
  pullRequests: string[];
  updatedAt: string | null;
}

export class DevinApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function devinConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DevinConfig | undefined {
  const apiKey = env.DEVIN_API_KEY;
  if (!apiKey) return undefined;
  return { apiKey, baseUrl: env.DEVIN_API_BASE_URL, orgId: env.DEVIN_ORG_ID };
}

export function sessionEndpoint(config: DevinConfig): string {
  const base = (config.baseUrl ?? "https://api.devin.ai").replace(/\/+$/, "");
  return config.orgId ? `${base}/v3/organizations/${encodeURIComponent(config.orgId)}/sessions` : `${base}/v1/sessions`;
}

export function sessionUrl(sessionId: string): string {
  return `https://app.devin.ai/sessions/${sessionId.replace(/^devin-/, "")}`;
}

function authHeaders(config: DevinConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" };
}

function parseBody(text: string, status: number): Record<string, unknown> {
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new DevinApiError("Devin API returned a non-JSON body", status, text);
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new DevinApiError("Devin API returned a non-object body", status, text);
  return json as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

const V3_STATE: Record<string, SessionStatus["state"]> = {
  new: "running",
  claimed: "running",
  running: "running",
  resuming: "running",
  suspended: "suspended",
  exit: "finished",
  error: "error",
};
const V1_STATE: Record<string, SessionStatus["state"]> = {
  working: "running",
  resumed: "running",
  resume_requested: "running",
  resume_requested_frontend: "running",
  blocked: "blocked",
  finished: "finished",
  expired: "finished",
  suspend_requested: "suspended",
  suspend_requested_frontend: "suspended",
};

export function normalizeSession(o: Record<string, unknown>): SessionStatus {
  const sessionId = str(o.session_id) ?? "";
  const status = str(o.status) ?? "unknown";
  const detail = str(o.status_detail) ?? str(o.status_enum);
  let state: SessionStatus["state"] = V3_STATE[status] ?? V1_STATE[status] ?? "unknown";
  if (detail && (detail === "waiting_for_user" || detail === "waiting_for_approval")) state = "blocked";
  if (detail && state === "unknown") state = V1_STATE[detail] ?? "unknown";

  const pullRequests: string[] = [];
  if (Array.isArray(o.pull_requests)) {
    for (const pr of o.pull_requests) {
      if (pr && typeof pr === "object") {
        const url = str((pr as Record<string, unknown>).url);
        if (url) pullRequests.push(url);
      }
    }
  } else if (o.pull_request && typeof o.pull_request === "object") {
    const url = str((o.pull_request as Record<string, unknown>).url);
    if (url) pullRequests.push(url);
  }

  const updated = o.updated_at;
  const updatedAt = typeof updated === "number" ? new Date(updated * 1000).toISOString() : str(updated);

  return {
    sessionId,
    url: str(o.url) ?? sessionUrl(sessionId),
    title: str(o.title),
    state,
    status: detail ? `${status} (${detail})` : status,
    pullRequests,
    updatedAt,
  };
}

export async function getDevinSession(config: DevinConfig, sessionId: string, fetchImpl: FetchLike = fetch): Promise<SessionStatus> {
  const endpoint = `${sessionEndpoint(config)}/${encodeURIComponent(sessionId)}`;
  const res = await fetchImpl(endpoint, { method: "GET", headers: authHeaders(config) });
  const text = await res.text();
  if (!res.ok) throw new DevinApiError(`Devin API ${res.status} from ${endpoint}`, res.status, text);
  return normalizeSession(parseBody(text, res.status));
}

export async function createDevinSession(
  config: DevinConfig,
  input: CreateSessionInput,
  fetchImpl: FetchLike = fetch,
): Promise<CreateSessionResult> {
  const endpoint = sessionEndpoint(config);
  const body: Record<string, unknown> = { prompt: input.prompt };
  if (input.title) body.title = input.title;
  if (input.tags && input.tags.length > 0) body.tags = input.tags;
  if (input.playbookId) body.playbook_id = input.playbookId;
  if (input.maxAcuLimit !== undefined) body.max_acu_limit = input.maxAcuLimit;
  if (input.unlisted !== undefined) body.unlisted = input.unlisted;
  if (input.idempotent !== undefined) body.idempotent = input.idempotent;
  if (input.createAsUserId && config.orgId) body.create_as_user_id = input.createAsUserId;

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { ...authHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new DevinApiError(`Devin API ${res.status} from ${endpoint}`, res.status, text);

  const o = parseBody(text, res.status);
  const sessionId = str(o.session_id);
  if (!sessionId) throw new DevinApiError("Devin API response missing session_id", res.status, text);
  return {
    sessionId,
    url: str(o.url) ?? sessionUrl(sessionId),
    isNewSession: typeof o.is_new_session === "boolean" ? o.is_new_session : null,
    endpoint,
  };
}
