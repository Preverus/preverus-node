import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpClient } from "./http.js";
import type { ApiResult, DecisionInput, DecisionResult, EventInput, PreverusNodeConfig, RequestOptions, WebhookEvent, WebhookHandlers } from "./types.js";

export function createPreverusNode(config: PreverusNodeConfig): PreverusNodeClient {
  return new PreverusNodeClient(config);
}

export class PreverusNodeClient {
  private readonly http: HttpClient;

  constructor(config: PreverusNodeConfig) {
    this.http = new HttpClient(config.serverKey, config);
  }

  async evaluate(input: DecisionInput, options: RequestOptions = {}): Promise<DecisionResult> {
    return this.http.post("/v1/decision/evaluate", stripEmpty(input), requestHeaders(options)) as Promise<DecisionResult>;
  }

  async trackEvent(input: EventInput, options: RequestOptions = {}): Promise<ApiResult> {
    return this.http.post("/v1/events", stripEmpty(input), requestHeaders(options));
  }

  async lookupVisitor(input: { visitorId?: string; fingerprint?: string; ip?: string }): Promise<ApiResult> {
    return this.http.get("/v1/score/visitors/lookup", {
      visitor_id: input.visitorId,
      fingerprint: input.fingerprint,
      ip: input.ip,
    });
  }

  async lookupMetadata(input: { key: string; value: string; includeGlobal?: boolean; visitorLimit?: number }): Promise<ApiResult> {
    return this.http.get("/v1/score/metadata/lookup", {
      key: input.key,
      value: input.value,
      include_global: input.includeGlobal ?? true,
      visitor_limit: input.visitorLimit ?? 20,
    });
  }

  async metadataGraph(input: { visitorId: string; limit?: number }): Promise<ApiResult> {
    return this.http.get("/v1/score/metadata/graph", {
      visitor_id: input.visitorId,
      limit: input.limit ?? 50,
    });
  }

  verifyWebhook(input: { rawBody: string | Buffer; timestamp: string; signatureHeader: string; secret: string; toleranceSeconds?: number }): boolean {
    const toleranceSeconds = input.toleranceSeconds ?? 300;
    if (!/^\d+$/.test(input.timestamp) || !input.signatureHeader || !input.secret) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(input.timestamp)) > toleranceSeconds) return false;

    const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.`).update(input.rawBody).digest("hex");
    const received = input.signatureHeader.replace(/^v1=/, "").trim();
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(received, "hex");
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  constructWebhookEvent(input: {
    rawBody: string | Buffer;
    headers: Headers | Record<string, string | string[] | undefined>;
    secret: string;
    toleranceSeconds?: number;
  }): WebhookEvent {
    const timestamp = headerValue(input.headers, "X-Fraud-Webhook-Timestamp");
    const signatureHeader = headerValue(input.headers, "X-Fraud-Webhook-Signature");
    if (!this.verifyWebhook({ rawBody: input.rawBody, timestamp, signatureHeader, secret: input.secret, toleranceSeconds: input.toleranceSeconds })) {
      throw new Error("Invalid Preverus webhook signature.");
    }

    const rawText = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : input.rawBody;
    const payload = JSON.parse(rawText) as Record<string, unknown>;
    return {
      id: typeof payload.id === "string" ? payload.id : "",
      type: typeof payload.type === "string" ? payload.type : "",
      payload,
      rawBody: input.rawBody,
    };
  }

  async dispatchWebhook(event: WebhookEvent, handlers: WebhookHandlers): Promise<unknown> {
    const handler = handlers[event.type] ?? handlers["*"];
    return handler ? handler(event) : undefined;
  }
}

function requestHeaders(options: RequestOptions): Record<string, string> {
  return stripEmpty({
    ...(options.headers ?? {}),
    "X-Visitor-ID": options.visitorId,
    "X-Idempotency-Key": options.idempotencyKey,
  }) as Record<string, string>;
}

function stripEmpty<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") output[key] = value;
  }
  return output as T;
}

function headerValue(headers: Headers | Record<string, string | string[] | undefined>, key: string): string {
  if (headers instanceof Headers) return headers.get(key) ?? "";
  const direct = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(direct)) return direct[0] ?? "";
  return direct ?? "";
}
