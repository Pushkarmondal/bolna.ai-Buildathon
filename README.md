# Bhaav

A voice agent that phones suppliers for a small business, gets real quotes in Hindi, Hinglish or English, and bargains using only offers it truly has. A lie-catcher checks every number before Bolna speaks it.

Built for the Bolna Buildathon (October 2026).

## What it does

1. The buyer tells the **Desk** agent what they need (browser call) or types it, and lists the suppliers they already buy from.
2. The **Caller** agent phones each supplier, one at a time, asks the price, reads it back, and saves it to the quote book only after the supplier says yes.
3. It calls the costlier suppliers back once with the best real offer.
4. The buyer sees the ranked quotes, the rupees saved and the recordings, and approves one. Bhaav never agrees to a deal or places an order.
5. **Be the supplier:** a judge takes the Caller's call in the browser and tries to make it say a price it can't prove.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | TypeScript, React, Vite, React Router, TanStack Query, Tailwind CSS (`web/`) |
| Backend | TypeScript, Hono on Cloudflare Workers, Zod (`worker/`) |
| Database | Cloudflare D1 (SQLite), Drizzle ORM, SQL migrations from drizzle-kit |
| Voice | Bolna: agents, phone calls, Web Call SDK; Sarvam Saaras (STT) and Bulbul v4 Flash (TTS) |
| LLM | Groq (`gpt-oss-20b`, falling back to `gpt-oss-120b`, then `qwen3.8-27b`), only through the Worker |
| Tests | Vitest inside the Workers runtime (`@cloudflare/vitest-plugin`); Biome for lint and format |

## How the lie-catcher works

Bolna sends every turn to the Worker's `/v1/chat/completions` (an OpenAI-compatible custom LLM). The Worker asks Groq for the reply, cuts it into sentences, and finds every number in each, whether written as digits, Indian grouping, or Hindi or English words ("battees", "saade chaalis", "dedh sau"). A sentence goes on to Bolna only if every number is in the quote book, the order, the best offer, or what the supplier said in this call. Otherwise Bhaav says "Ek second ji, main apne notes check karta hoon" and the screen shows the block in red. A `save_quote` call is checked the same way against the supplier's last few messages.

## Layout

```text
shared/src/index.ts         types shared by web and worker
worker/src/index.ts         Hono app: every route, plus the cron
worker/src/llm.ts           custom LLM endpoint: model fallback + lie-catcher
worker/src/numbers.ts       finds numbers in a sentence
worker/src/engine.ts        landed price, best offer, round-2 list
worker/src/dialler.ts       one call at a time, round 1 then round 2; limits; webhook handling
worker/src/tools.ts         Bolna custom functions: update_order, start_calls, save_quote, do_not_call
worker/src/practice.ts      "Be the supplier" personas and practice orders
worker/src/prompts.ts       the Desk and Caller prompts
worker/src/agents.ts        the two Bolna agent configs
worker/src/db/              Drizzle schema and the lie-catcher's database reads
worker/migrations/          SQL migrations (quotes and events are append-only)
web/src/                    React app: Home, Order (talk / live calls), Results, Be the supplier, Test bench
scripts/setup-agents.ts     registers the custom LLM and creates both Bolna agents
scripts/fake-bolna.ts       a stand-in for Bolna's API, for running everything locally
bench/run.ts                the test bench: simulated chats through the real lie-catcher
```

## Run it locally (no accounts needed)

Needs Node 24 (`nvm use`).

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars    # fill in random values; uncomment the fake-Bolna lines
npm run db:migrate:local -w worker
npm run build
npm run dev:worker                               # http://localhost:8787
```

In a second terminal, run the fake Bolna with the same secrets:

```bash
set -a; . worker/.dev.vars; set +a; WORKER_URL=http://localhost:8787 npm run fake-bolna
```

Open http://localhost:8787, enter `APP_PASSCODE`, create an order, add suppliers (any 10-digit numbers; nothing is dialled), and press **Start calling**. The fake calls play out in about 30 seconds. Browser calls (Talk and Be the supplier) need the real Bolna.

For frontend work with hot reload, also run `npm run dev:web` and open http://localhost:5173.

## Checks

```bash
npm test            # 86 tests inside the Workers runtime, with a local D1 and a faked Bolna
npm run typecheck   # every package, plus scripts and bench
npm run lint
npm run bench -- --dry   # the bench harness, scripted, no network
```

## Deploy

1. **Accounts** (all free to start): Cloudflare, Bolna, Groq, Sarvam. Ask Bolna in their builders' Slack to switch on the Web Call SDK. In Bolna, add your Sarvam key under *Settings → Integrations*.
2. **Log in and create the database:**
   ```bash
   cd worker
   npx wrangler login
   npx wrangler d1 create bhaav        # put the printed database_id in wrangler.toml
   npm run db:migrate:remote
   ```
3. **Secrets** (inside `worker/`). Generate each random one with `openssl rand -hex 24`:
   ```bash
   for name in GROQ_API_KEY LLM_SECRET BOLNA_API_KEY TOOL_SECRET WEBHOOK_SECRET APP_PASSCODE COOKIE_SECRET; do npx wrangler secret put $name; done
   ```
4. **Deploy** (from the repo root): `npm run build && npm run deploy -w worker`. Note the `https://bhaav.<you>.workers.dev` URL.
5. **Create the Bolna agents:**
   ```bash
   WORKER_URL=https://bhaav.<you>.workers.dev BOLNA_API_KEY=… LLM_SECRET=… TOOL_SECRET=… WEBHOOK_SECRET=… npm run agents:setup
   ```
   Put the two printed ids in `worker/wrangler.toml` (`BOLNA_DESK_AGENT_ID`, `BOLNA_CALLER_AGENT_ID`). If Bolna refuses the API body, `npm run agents:print` writes `bolna/*-agent.json` and `bolna/*-tools.json` to paste into the dashboard instead.
6. **Set the limits** in `worker/wrangler.toml`: `SUPPLIER_ALLOWLIST` (the numbers of suppliers who agreed) and `MAX_CALLS_PER_DAY`. Then deploy again.
7. **Test** in this order: a test call from each agent in Bolna's dashboard; Talk in the app; Be the supplier; then one real supplier who agreed.
8. **Bench:** `GROQ_API_KEY=… npm run bench`, then `npm run build && npm run deploy -w worker` to publish the results on `/bench`.

## Settings

| Name | Kind | What it does |
| --- | --- | --- |
| `GROQ_API_KEY` | secret | Groq key for the LLM |
| `LLM_SECRET` | secret | Bearer token Bolna uses for `/v1/*` |
| `BOLNA_API_KEY` | secret | Places calls, mints browser sessions, reads executions |
| `TOOL_SECRET` | secret | Bearer token on Bolna's calls to `/tools/*` |
| `WEBHOOK_SECRET` | secret | Last part of the webhook URL |
| `APP_PASSCODE` | secret | Opens the app |
| `COOKIE_SECRET` | secret | Signs the session cookie |
| `GROQ_MODELS` | var | Models to try, in order |
| `BOLNA_DESK_AGENT_ID`, `BOLNA_CALLER_AGENT_ID` | var | From `npm run agents:setup` |
| `BOLNA_FROM_NUMBER` | var | Optional caller number bought in Bolna |
| `SUPPLIER_ALLOWLIST` | var | Comma-separated numbers Bhaav may call; empty allows any |
| `MAX_CALLS_PER_DAY` | var | Phone calls allowed in any 24 hours (default 60) |

## Safety rules built into the code

- The lie-catcher checks every number before it is spoken, and every price before it is saved.
- The Caller has no tool to accept a deal; only the buyer's Approve button can choose a supplier.
- `quotes` and `events` are append-only: database triggers refuse any edit or delete.
- One live phone call per order at a time, enforced by a unique index, so two dialler runs can't double-dial.
- A supplier who says "don't call" is marked on every order, and that number can't be added again.
- Practice calls are labelled practice, capped at 30 an hour, and stopped after 2 minutes in the browser.
- A cron every minute recovers calls whose webhook never arrived.
