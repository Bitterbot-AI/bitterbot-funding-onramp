/**
 * Node.js entry point.
 * Run with: pnpm dev  (tsx watch)
 * Or build: pnpm build && pnpm start
 */
import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

// Load env vars into the Hono app's bindings
const app = createApp();

const port = parseInt(process.env.PORT || "8787", 10);
const host = process.env.HOST || "0.0.0.0";

console.log(`bitterbot-funding-onramp listening on http://${host}:${port}`);

serve({
  fetch: (req) => {
    // Inject process.env as Hono bindings so the app reads secrets the same way
    return app.fetch(req, {
      STRIPE_SECRET_KEY_LIVE: process.env.STRIPE_SECRET_KEY_LIVE ?? "",
      STRIPE_PUBLISHABLE_KEY_LIVE: process.env.STRIPE_PUBLISHABLE_KEY_LIVE ?? "",
    });
  },
  port,
  hostname: host,
});
