# Preverus Node

Node.js backend client for Preverus fraud decisions, events, lookups, and webhooks.

This package is for server-side code only. It uses your private server key and must never be imported into browser bundles.

## Install

```bash
npm install @preverus/node
```

Requires Node.js 18+.

## Browser And Server Flow

Load the hosted browser script on server-rendered or frontend pages:

```html
<script
  src="https://cdn.preverus.com/v1/preverus.js"
  data-preverus-key="pk_live_xxx"
  data-preverus-auto="true"
  data-preverus-track-forms="true"
></script>

<form method="POST" action="/register" data-preverus-action="signup">
  <input name="email" type="email">
  <button type="submit">Create account</button>
</form>
```

Before submit, the script attaches:

```text
preverus_fingerprint
preverus_visitor_id
preverus_risk_session_token
preverus_browser_session_event_id
```

Your Node backend sends those values to Preverus with a private server key before approving sensitive actions.

## Quick Start

```ts
import { createPreverusNode } from "@preverus/node";

const preverus = createPreverusNode({
  serverKey: process.env.PREVERUS_SERVER_KEY!,
});

const decision = await preverus.evaluate(
  {
    event_type: "signup",
    user_id: "acct_42",
    ip: req.ip,
    risk_session_token: req.body.preverus_risk_session_token,
    fingerprint: req.body.preverus_fingerprint,
    metadata: {
      email: req.body.email,
      browser_session_event_id: req.body.preverus_browser_session_event_id,
    },
  },
  {
    visitorId: req.body.preverus_visitor_id,
    idempotencyKey: req.id,
  },
);

if (decision.recommended_action === "block" || decision.recommended_action === "deny") {
  res.status(403).send("Unable to create account.");
  return;
}

if (decision.recommended_action === "review") {
  res.redirect("/verify");
  return;
}
```

Prefer `risk_session_token` when available. It links the trusted backend action to the browser session collected moments earlier.

## Configuration

```ts
const preverus = createPreverusNode({
  serverKey: process.env.PREVERUS_SERVER_KEY!,
  endpoint: "https://api.preverus.com",
  timeoutMs: 1500,
  retries: 2,
  retryDelayMs: 150,
  maxRetryDelayMs: 1000,
});
```

The client retries transient network failures and retryable statuses:

```text
408, 409, 425, 429, 500, 502, 503, 504
```

It does not retry validation or authentication errors such as `400`, `401`, `403`, or `422`.

Use idempotency keys for retried POST requests.

## Express Example

```ts
app.post("/register", async (req, res) => {
  const decision = await preverus.evaluate(
    {
      event_type: "signup",
      user_id: req.body.user_id,
      ip: req.ip,
      risk_session_token: req.body.preverus_risk_session_token,
      fingerprint: req.body.preverus_fingerprint,
      metadata: {
        email: req.body.email,
        user_agent: req.get("user-agent"),
      },
    },
    {
      visitorId: req.body.preverus_visitor_id,
      idempotencyKey: req.id,
    },
  );

  if (decision.recommended_action === "block" || decision.recommended_action === "deny") {
    return res.status(403).send("Unable to create account.");
  }

  if (decision.recommended_action === "review") {
    return res.redirect("/verify");
  }

  // Continue registration.
});
```

## Next.js Route Handler Example

```ts
import { createPreverusNode } from "@preverus/node";
import { NextResponse } from "next/server";

const preverus = createPreverusNode({
  serverKey: process.env.PREVERUS_SERVER_KEY!,
});

export async function POST(request: Request) {
  const body = await request.json();
  const decision = await preverus.evaluate(
    {
      event_type: "checkout",
      user_id: body.user_id,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0],
      risk_session_token: body.preverus_risk_session_token,
      fingerprint: body.preverus_fingerprint,
      metadata: {
        email: body.email,
        order_id: body.order_id,
      },
    },
    {
      visitorId: body.preverus_visitor_id,
      idempotencyKey: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    },
  );

  if (decision.recommended_action === "block" || decision.recommended_action === "deny") {
    return NextResponse.json({ error: "blocked" }, { status: 403 });
  }

  return NextResponse.json({ decision });
}
```

## Events

Use events for non-blocking fraud telemetry:

```ts
await preverus.trackEvent(
  {
    event_type: "login",
    user_id: "acct_42",
    ip: "203.0.113.10",
    fingerprint: "fp_hash",
    metadata: { email: "person@example.com" },
  },
  { visitorId: "v_abc123", idempotencyKey: "login:acct_42:req_123" },
);
```

## Lookups

```ts
const visitor = await preverus.lookupVisitor({ visitorId: "v_abc123" });
const visitorByFingerprint = await preverus.lookupVisitor({ fingerprint: "fp_hash" });

const metadata = await preverus.lookupMetadata({ key: "email", value: "person@example.com" });
const graph = await preverus.metadataGraph({ visitorId: "v_abc123" });
```

Use lookups for investigation and context. Use `evaluate()` for final enforcement.

## Webhook Verification

Use the raw request body for verification.

```ts
const valid = preverus.verifyWebhook({
  rawBody,
  timestamp: req.get("X-Fraud-Webhook-Timestamp") ?? "",
  signatureHeader: req.get("X-Fraud-Webhook-Signature") ?? "",
  secret: process.env.PREVERUS_WEBHOOK_SECRET!,
});

if (!valid) {
  res.status(400).send("Invalid signature");
  return;
}
```

Webhook delivery is at-least-once. Dedupe by `X-Fraud-Webhook-Id` or payload `id`.

You can also verify, parse, and dispatch by event type:

```ts
const event = preverus.constructWebhookEvent({
  rawBody,
  headers: req.headers,
  secret: process.env.PREVERUS_WEBHOOK_SECRET!,
});

if (await alreadyProcessed(event.id)) {
  res.status(204).end();
  return;
}

await preverus.dispatchWebhook(event, {
  'decision.high_risk': async (event) => {
    await openCase(event.payload);
  },
  '*': async (event) => {
    console.log('Preverus webhook', event.type);
  },
});
```

The package verifies and parses the event, but your app should store processed event IDs in your database or cache.

## Failure Handling

The package throws `ApiError` and `NetworkError`:

```ts
import { ApiError, NetworkError } from "@preverus/node";

try {
  const decision = await preverus.evaluate(...);
} catch (error) {
  if (error instanceof ApiError) {
    console.warn(error.statusCode, error.errorCode);
  }
  if (error instanceof NetworkError) {
    // Apply your app's fail-open, fail-review, or fail-closed policy.
  }
}
```

For high-risk flows like withdrawals and payouts, a common policy is fail-review. For signup/login/checkout, many businesses prefer fail-open so the site keeps working during transient failures.

## Production Checklist

- Never import this package into browser code.
- Keep `PREVERUS_SERVER_KEY` private.
- Use the browser key only with the hosted script or browser SDK.
- Prefer `risk_session_token` when present.
- Include `visitorId` when available.
- Send your real customer account ID as `user_id`.
- Include IP and metadata such as email, phone, username, and payment address.
- Use idempotency keys for retried POST requests.
- Treat `review` as step-up/manual review, not as automatic allow.
