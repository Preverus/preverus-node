import { ApiError, NetworkError } from "./errors.js";

const retryableStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly serverKey: string,
    options: {
      endpoint?: string;
      timeoutMs?: number;
      retries?: number;
      retryDelayMs?: number;
      maxRetryDelayMs?: number;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.endpoint = (options.endpoint ?? "https://api.preverus.com").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.retries = Math.max(0, options.retries ?? 2);
    this.retryDelayMs = options.retryDelayMs ?? 150;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 1000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async get(path: string, query: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return this.request("GET", `${path}${suffix}`, undefined, headers);
  }

  async post(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return this.request("POST", path, body, headers);
  }

  private async request(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (!this.serverKey.trim()) {
      throw new ApiError("Missing Preverus server key.", 0, "missing_server_key");
    }

    const attempts = this.retries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.send(method, path, body, headers);
      } catch (error) {
        if (error instanceof ApiError) {
          if (!retryableStatuses.has(error.statusCode) || attempt >= attempts) throw error;
        } else if (error instanceof NetworkError) {
          if (attempt >= attempts) throw error;
        } else {
          throw error;
        }
        await this.sleepBeforeRetry(attempt);
      }
    }

    throw new NetworkError();
  }

  private async send(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.endpoint}/${path.replace(/^\/+/, "")}`, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "preverus-node/0.1",
          "X-API-Key": this.serverKey,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      const decoded = text ? safeJson(text) : {};
      if (!response.ok) {
        const payload = isRecord(decoded) ? decoded : {};
        throw new ApiError(
          typeof payload.message === "string" ? payload.message : "Preverus API error.",
          response.status,
          typeof payload.code === "string" ? payload.code : "api_error",
          decoded,
        );
      }

      return isRecord(decoded) ? decoded : { raw: decoded };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new NetworkError(error instanceof Error ? error.message : undefined);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sleepBeforeRetry(attempt: number): Promise<void> {
    const base = Math.min(this.maxRetryDelayMs, this.retryDelayMs * 2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * Math.max(1, base / 2));
    await new Promise((resolve) => setTimeout(resolve, base + jitter));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
