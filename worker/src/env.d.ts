// Secrets are not in wrangler.toml, so `wrangler types` can't see them. Set each with
// `npx wrangler secret put NAME` (production) or in .dev.vars (local).
declare namespace Cloudflare {
  interface Env {
    /** Groq API key, used only by /v1/chat/completions. */
    GROQ_API_KEY: string;
    /** Bearer token Bolna sends to /v1/chat/completions (the custom LLM's key). */
    LLM_SECRET: string;
    /** Bolna API key (bn-…), used to place calls, mint web sessions and read executions. */
    BOLNA_API_KEY: string;
    /** Bearer token on every Bolna custom function call to /tools/*. */
    TOOL_SECRET: string;
    /** Path segment of the webhook URL: /webhooks/bolna/<WEBHOOK_SECRET>. */
    WEBHOOK_SECRET: string;
    /** What judges and the buyer type to open the app. */
    APP_PASSCODE: string;
    /** Signs the session cookie. */
    COOKIE_SECRET: string;
  }

  // Types `exports.default` from "cloudflare:workers" (used by the integration tests).
  interface GlobalProps {
    mainModule: typeof import('./index');
  }
}
