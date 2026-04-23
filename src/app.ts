import { Hono } from "hono";
import { cors } from "hono/cors";
import Stripe from "stripe";

/**
 * Environment bindings — resolved from process.env (Node) or Workers secrets (CF).
 *
 * Live-only. Testnet funding was intentionally removed on 2026-04-22:
 * wallet-funding code is not an open contributor surface, so there is no
 * developer-testing use case for testnet keys. Any accidental request with
 * a testnet destination network is rejected below.
 */
export type Env = {
  STRIPE_SECRET_KEY_LIVE: string;
  STRIPE_PUBLISHABLE_KEY_LIVE: string;
};

type SessionBody = {
  walletAddress: string;
  network: "base";
  amount?: number;
};

/** In-memory rate-limit: max requests per window per key. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const hits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use("/*", cors());

  // Health check
  app.get("/", (c) => c.json({ ok: true, service: "bitterbot-funding-onramp" }));

  // Create Stripe Crypto Onramp session
  app.post("/session", async (c) => {
    const body = await c.req.json<SessionBody>().catch(() => null);
    if (!body?.walletAddress || !body?.network) {
      return c.json({ error: "walletAddress and network are required" }, 400);
    }

    const { walletAddress, network } = body;
    if (network !== "base") {
      return c.json({ error: 'network must be "base"' }, 400);
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return c.json({ error: "Invalid wallet address" }, 400);
    }

    // Rate limit by IP + wallet address
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const rateLimitKey = `${ip}:${walletAddress}`;
    if (isRateLimited(rateLimitKey)) {
      return c.json({ error: "Rate limit exceeded. Try again shortly." }, 429);
    }

    const { STRIPE_SECRET_KEY_LIVE: secretKey, STRIPE_PUBLISHABLE_KEY_LIVE: publishableKey } =
      c.env;
    if (!secretKey || !publishableKey) {
      return c.json({ error: "Stripe live keys not configured on this service" }, 503);
    }

    try {
      const stripe = new Stripe(secretKey);

      // The crypto onramp API is not a built-in SDK resource —
      // use rawRequest to call it directly.
      const params: Record<string, string> = {
        "wallet_addresses[base_network]": walletAddress,
        lock_wallet_address: "true",
        "destination_currencies[0]": "usdc",
        "destination_networks[0]": "base",
      };
      if (body.amount != null) {
        params.destination_amount = body.amount.toString();
        params.destination_currency = "usdc";
      }

      // Stripe SDK v20 types rawRequest() as returning only { lastResponse },
      // but the crypto/onramp_sessions endpoint returns { id, client_secret,
      // ...lastResponse } at runtime. Cast through unknown because the SDK
      // types don't statically describe the endpoint-specific response body.
      const session = (await stripe.rawRequest("POST", "/v1/crypto/onramp_sessions", {
        ...params,
      })) as unknown as { id: string; client_secret: string };

      return c.json({
        clientSecret: session.client_secret,
        publishableKey,
      });
    } catch (err: unknown) {
      const stripeErr = err as { raw?: { statusCode?: number; type?: string; message?: string } };
      const status = stripeErr.raw?.statusCode;
      const message = err instanceof Error ? err.message : String(err);
      console.error("Stripe onramp session error:", message);

      // Surface actionable Stripe errors to the caller
      if (status === 404) {
        return c.json({
          error:
            "Stripe Crypto Onramp is not enabled for this account. " +
            "Apply at https://dashboard.stripe.com/crypto",
        }, 502);
      }
      return c.json({ error: `Stripe error: ${message}` }, 502);
    }
  });

  return app;
}
