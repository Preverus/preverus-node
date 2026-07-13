export type PreverusNodeConfig = {
  serverKey: string;
  endpoint?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  fetch?: typeof fetch;
};

export type RequestOptions = {
  visitorId?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
};

export type EventMetadata = Record<string, unknown>;

export type EventInput = {
  event_type: string;
  user_id?: string;
  ip?: string;
  fingerprint?: string;
  metadata?: EventMetadata;
};

export type DecisionInput = EventInput & {
  risk_session_token?: string;
  include_global?: boolean;
};

export type ApiResult = Record<string, unknown>;

export type DecisionResult = ApiResult & {
  recommended_action?: "allow" | "review" | "block" | "deny" | string;
  risk_tier?: string;
  reasons?: unknown[];
};

export type WebhookEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  rawBody: string | Buffer;
};

export type WebhookHandlers = Record<string, (event: WebhookEvent) => unknown | Promise<unknown>>;
