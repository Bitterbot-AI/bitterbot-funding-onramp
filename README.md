# bitterbot-funding-onramp

Hosted Stripe Crypto Onramp service for funding Bitterbot agent wallets.

The Bitterbot desktop client calls this service to get a `clientSecret` + `publishableKey` for the Stripe Crypto Onramp widget, so end users can fund their agent wallet without managing Stripe API keys themselves.

## Architecture

```
Bitterbot desktop client
  → POST https://onramp.bitterbot.ai/session
  → this service (Hono on Railway / Cloudflare Workers)
      → Stripe Crypto Onramp API (with server-held secret key)
  ← { clientSecret, publishableKey }
  → Stripe Onramp widget loads in the Bitterbot wallet view
```

## API

### `GET /`

Health check. Returns:

```json
{ "ok": true, "service": "bitterbot-funding-onramp" }
```

### `POST /session`

Creates a Stripe Crypto Onramp session.

Request body:

```json
{
  "walletAddress": "0x...",   // required, 0x-prefixed 40-hex-digit address
  "network": "base",          // required, live-only (see note below)
  "amount": 50                 // optional, USDC
}
```

Response:

```json
{ "clientSecret": "cos_...", "publishableKey": "pk_..." }
```

Rate-limited to 10 requests per IP+wallet per 60 seconds.

**Live-only:** this service does not accept testnet destinations. Wallet-funding code is not an open contributor surface, so there is no testnet path to exercise. Requests with any `network` other than `"base"` are rejected with 400.

## Deployment

### Railway

```bash
railway up
```

Configured via `railway.json`. Sets `PORT` automatically; the Node entry (`src/node.ts`) reads it.

### Cloudflare Workers

```bash
wrangler deploy
```

Configured via `wrangler.toml`. Secrets set via `wrangler secret put`.

### Secrets

Two env vars are required on the deploy target:

```
STRIPE_SECRET_KEY_LIVE
STRIPE_PUBLISHABLE_KEY_LIVE
```

Never commit these. Use `wrangler secret put` (Workers) or the Railway dashboard Variables tab.

For local development: copy `.env.example` to `.env` with live keys (or a personal Stripe sandbox account).

## Local development

```bash
pnpm install
cp .env.example .env   # fill in Stripe live keys
pnpm dev               # tsx watch src/node.ts on :8787
```

Health check:

```bash
curl http://localhost:8787/
```

Session test:

```bash
curl -X POST http://localhost:8787/session \
  -H 'Content-Type: application/json' \
  -d '{"walletAddress":"0x0000000000000000000000000000000000000000","network":"base"}'
```

## Related

- Desktop client: [`Bitterbot-AI/bitterbot-desktop`](https://github.com/Bitterbot-AI/bitterbot-desktop) — see `src/services/hosted-onramp.ts`
- Tracker: [Bitterbot-AI/bitterbot-desktop#14](https://github.com/Bitterbot-AI/bitterbot-desktop/issues/14)
