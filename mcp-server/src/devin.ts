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

export class DevinApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function devinConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DevinConfig | undefined {
  const apiKey = env.DEVIN_API_KEY;
  if (!apiKey) return undefined;
  return { apiKey, baseUrl: env.DEVIN_API_BASE_URL, orgId: env.DEVIN_ORG_ID };
}

export function sessionEndpoint(config: DevinConfig): string {
  const base = (config.baseUrl ?? "https://api.devin.ai").replace(/\/+$/, "");
  return config.orgId ? `${base}/v3/organizations/${encodeURIComponent(config.orgId)}/sessions` : `${base}/v1/sessions`;
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
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new DevinApiError(`Devin API ${res.status} from ${endpoint}`, res.status, text);

  const json: unknown = text ? JSON.parse(text) : {};
  if (json === null || typeof json !== "object") throw new DevinApiError("Devin API returned a non-object body", res.status, text);
  const o = json as Record<string, unknown>;
  const sessionId = o.session_id;
  const url = o.url;
  if (typeof sessionId !== "string" || typeof url !== "string") {
    throw new DevinApiError("Devin API response missing session_id/url", res.status, text);
  }
  return {
    sessionId,
    url,
    isNewSession: typeof o.is_new_session === "boolean" ? o.is_new_session : null,
    endpoint,
  };
}
