/**
 * Cloudflare Worker entry point.
 * Deploy with: pnpm deploy (runs wrangler deploy)
 * Set secrets with: wrangler secret put STRIPE_SECRET_KEY_TESTNET
 */
import { createApp } from "./app.js";

const app = createApp();

export default app;
