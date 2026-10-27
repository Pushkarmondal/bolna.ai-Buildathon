# Bhaav

A voice agent that phones suppliers for a small business, gets real quotes in Hindi, Hinglish, Kannada or English, and bargains using only offers it truly has. A lie-catcher checks every number before Bolna speaks it.

Built for the Bolna Buildathon (October 2026).

## What it does

1. The buyer tells the **Desk** agent what they need (browser call) or types it, and lists the suppliers they already buy from.
2. The **Caller** agent phones each supplier, one at a time, asks the price, reads it back, and saves it to the quote book only after the supplier says yes.
3. It calls the costlier suppliers back once with the best real offer.
4. The buyer sees the ranked quotes, the rupees saved and the recordings, and approves one. Bhaav never agrees to a deal or places an order.
5. **Confirmation call (optional):** Bhaav phones the chosen supplier to say the buyer accepted their quote and will call to arrange payment. If the supplier changes the price on that call, the new terms are recorded and the results page warns the buyer.
6. **WhatsApp summary:** the ranked quotes as plain text, to copy or open straight in WhatsApp.
7. **Price memory:** every order's best delivered price per item, with a chart once there are four orders, and "last time" on each new result.
8. **Be the supplier:** a judge takes the Caller's call in the browser and tries to make it say a price it can't prove.

Each supplier is called in their own language: Hindi (written in Devanagari so the voice reads it right), Kannada (in Kannada script) or English, and Bhaav switches if they do.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | TypeScript, React, Vite, React Router, TanStack Query, Tailwind CSS, Phosphor icons (`web/`) |
| Backend | TypeScript, Hono on Cloudflare Workers, Zod (`worker/`) |
| Database | Cloudflare D1 (SQLite), Drizzle ORM, SQL migrations from drizzle-kit |
| Voice | Bolna: agents, phone calls, Web Call SDK; Sarvam Saaras (STT) and Bulbul v4 Flash (TTS) |
| LLM | Groq (`gpt-oss-20b`, falling back to `gpt-oss-120b`, then `qwen3.8-27b`), only through the Worker |
| Tests | Vitest inside the Workers runtime (`@cloudflare/vitest-plugin`), Vitest for the web app's logic, Playwright in Chrome end to end; Biome for lint and format |

## How the lie-catcher works

Bolna sends every turn to the Worker's `/v1/chat/completions` (an OpenAI-compatible custom LLM). The Worker asks Groq for the reply, cuts it into sentences, and finds every number in each, whether written as digits, Indian grouping, or Hindi or English words ("battees", "saade chaalis", "dedh sau"). A sentence goes on to Bolna only if every number is in the quote book, the order, the best offer, or what the supplier said in this call. Otherwise Bhaav says "Ek second ji, main apne notes check karta hoon" and the screen shows the block in red. A `save_quote` call is checked the same way against the supplier's last few messages.

Two refinements:

- **Offers must be proven.** A sentence that speaks of an offer from elsewhere ("मेरे पास … का offer है", "दूसरे supplier ने …", "other shop", "market") may only use numbers from the quote book, never one the supplier merely said. A supplier who says "the other shop said ₹70, na?" can't get Bhaav to agree. Bhaav can still read ₹70 back to them.
- **The Desk is checked for prices only.** It talks to the buyer about their own order, so it may read back a date or quantity it is saving in the same breath. It still can't name a price nobody gave.

A stopped sentence silences the rest of the reply, but not its tool calls: each tool call has its own check. If a model doesn't start answering within 2.5 seconds, the next model is asked. If an answer goes quiet for 4 seconds, Bhaav says its safe line instead of leaving silence. Groq's reasoning models are asked to think briefly (`reasoning_effort`), so the thinking doesn't eat the reply's token cap.

The test bench audits every chat with a stricter rule of its own. Every number Bhaav states must be in the quote book, and only a read-back question may repeat the supplier's number. So it also flags an agreement to a planted number that uses none of the offer words.

## Layout

```text
shared/src/index.ts         types shared by web and worker
worker/src/index.ts         Hono app: every route, plus the cron
worker/src/llm.ts           custom LLM endpoint: model fallback + lie-catcher
worker/src/numbers.ts       finds numbers in a sentence
worker/src/engine.ts        landed price, best offer, round-2 list
worker/src/dialler.ts       one call at a time across orders, in calling hours: round 1 asks, round 2 bargains,
                            round 3 confirms; retries when Bolna is busy; limits; webhooks
worker/src/prices.ts        price memory: each past order's best price per item
worker/src/tools.ts         Bolna custom functions: update_order, start_calls, save_quote, do_not_call
worker/src/practice.ts      "Be the supplier" personas and practice orders
worker/src/prompts.ts       the Desk and Caller prompts
worker/src/agents.ts        the Bolna agent configs: Desk, Caller, practice Caller (2 minutes), Caller as a graph agent
worker/src/db/              Drizzle schema and the lie-catcher's database reads
worker/migrations/          SQL migrations (quotes and events are append-only)
web/src/                    React app: Home, Order (talk / live calls), Results, Price memory, Be the supplier, Test bench
web/src/choice.ts           what became of the buyer's choice after the confirmation call
web/src/summary.ts          the WhatsApp text
web/src/chart.tsx           the price chart (SVG, no chart library)
web/test/                   unit tests for the web app's logic
e2e/                        Playwright tests: every journey, every link, the fit check and contrast, against the fake Bolna
design-system/bhaav/        the design system (colours, type, rules) and where the code departs from it
scripts/setup-agents.ts     registers the custom LLM and creates both Bolna agents
scripts/fake-bolna.ts       a stand-in for Bolna's API, for running everything locally
bench/run.ts                the test bench: simulated chats through the real lie-catcher, audited separately
.github/workflows/ci.yml    lint, typecheck, tests, build and the scripted bench on every push
```

## Run it locally (no accounts needed)

Needs Node 24 (`nvm use`).

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars    # fill in random values; uncomment the fake-Bolna and local-run lines
npm run db:migrate:local -w worker
npm run build
npm run dev:worker                               # http://localhost:8787
```

In a second terminal, run the fake Bolna with the same secrets:

```bash
set -a; . worker/.dev.vars; set +a; WORKER_URL=http://localhost:8787 npm run fake-bolna
```

Open http://localhost:8787, enter `APP_PASSCODE`, create an order, add suppliers (any 10-digit numbers; nothing is dialled), and press **Start calling**. The fake calls play out in about 30 seconds. Browser calls (Talk and Be the supplier) need the real Bolna. The fake also stands in for Groq (`GROQ_BASE_URL=http://localhost:8790/groq`): it refuses every turn, so Bhaav says its safe line, except one scripted lie the tests use to watch the lie-catcher stop it.

For frontend work with hot reload, also run `npm run dev:web` and open http://localhost:5173.

## Checks

```bash
npm test            # 148 Worker tests (Workers runtime, local D1, faked Bolna) + 30 web tests
npm run typecheck   # every package, plus scripts, bench and e2e
npm run lint
npm run e2e         # builds, then runs 33 Playwright tests in your installed Chrome: journeys, links, fit at 9 widths, contrast
npm run bench -- --dry   # the bench harness, scripted, no network
```

## Deploy

1. **Accounts** (all free to start): Cloudflare, Bolna, Groq, Sarvam. Ask Bolna in their builders' Slack to switch on the Web Call SDK. In Bolna, add your Sarvam key under *Settings → Integrations*.
2. **Log in and create the database** (in India, so the Worker's reads are short):
   ```bash
   cd worker
   npx wrangler login
   npx wrangler d1 create bhaav --location apac   # put the printed database_id in wrangler.toml
   npm run db:migrate:remote
   ```
   After pulling new code, run `npm run db:migrate:remote` again before deploying: it applies any new migration once.
3. **Secrets** (inside `worker/`). Generate each random one with `openssl rand -hex 24`:
   ```bash
   for name in GROQ_API_KEY LLM_SECRET BOLNA_API_KEY TOOL_SECRET WEBHOOK_SECRET APP_PASSCODE COOKIE_SECRET; do npx wrangler secret put $name; done
   ```
4. **Deploy** (from the repo root): `npm run build && npm run deploy -w worker`. Note the `https://bhaav.<you>.workers.dev` URL.
5. **Create the Bolna agents:**
   ```bash
   WORKER_URL=https://bhaav.<you>.workers.dev BOLNA_API_KEY=… LLM_SECRET=… TOOL_SECRET=… WEBHOOK_SECRET=… npm run agents:setup
   ```
   Put the three printed ids in `worker/wrangler.toml` (`BOLNA_DESK_AGENT_ID`, `BOLNA_CALLER_AGENT_ID`, `BOLNA_PRACTICE_AGENT_ID`). Add `--graph` to create the Caller as a Bolna graph agent (greet, ask, read back, bargain, confirm, close) instead of a single prompt. If Bolna refuses the API body, `npm run agents:print` writes `bolna/*-agent.json` and `bolna/*-tools.json` to paste into the dashboard instead.
6. **Set the limits** in `worker/wrangler.toml`. `SUPPLIER_ALLOWLIST` lists the numbers of suppliers who agreed; until it is set, no supplier can be added. Check `MAX_CALLS_PER_DAY` and `CALL_HOURS`. Then deploy again.
7. **Test** in this order: a test call from each agent in Bolna's dashboard; Talk in the app; Be the supplier; then one real supplier who agreed.
8. **Bench:** `GROQ_API_KEY=… npm run bench`, then `npm run build && npm run deploy -w worker` to publish the results on `/bench`. Fifty chats use more than one day of Groq's free allowance, so run them over two days, or with `BENCH_RUNS=25`.

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
| `BOLNA_DESK_AGENT_ID`, `BOLNA_CALLER_AGENT_ID`, `BOLNA_PRACTICE_AGENT_ID` | var | From `npm run agents:setup`; without a practice agent, practice calls use the Caller and only the browser stops them at 2 minutes |
| `BOLNA_FROM_NUMBER` | var | Optional caller number bought in Bolna |
| `SUPPLIER_ALLOWLIST` | var | Comma-separated numbers Bhaav may call; empty allows none; `*` allows any (local fakes only) |
| `MAX_CALLS_PER_DAY` | var | Phone calls allowed in any 24 hours (default 60) |
| `MAX_LIVE_CALLS` | var | Phone calls live at once across every order (default 1) |
| `CALL_HOURS` | var | Hours in India when suppliers may be called (default `10-19`); calls wait outside them |
| `BOLNA_WEBHOOK_IPS` | var | Addresses Bolna's webhooks come from (Bolna's three, by default); `*` accepts any |

## Design

An Apple-style look, chosen with the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) design skill and written down in `design-system/bhaav/MASTER.md` ("Apple direction"): San Francisco on Apple devices and Inter elsewhere (with Noto Devanagari and Kannada), a grey canvas with white cards, one blue for actions, frosted top and tab bars, pill buttons, and grouped lists. Light and dark themes have every text pair at 4.5:1 or better. `e2e/fit.spec.ts` checks every page at nine widths, 320 to 1440px, with worst-case data: nothing may spill, overlap or scroll sideways.

## Safety rules built into the code

- The lie-catcher checks every number before it is spoken, and every price before it is saved.
- The Caller has no tool to accept a deal; only the buyer's Approve button can choose a supplier.
- `quotes` and `events` are append-only: database triggers refuse any edit or delete.
- One live phone call per order at a time, enforced by a unique index, so two dialler runs can't double-dial; and one across all orders (`MAX_LIVE_CALLS`), so Bolna's trial limit isn't hit.
- Suppliers are called only between 10:00 and 19:00 India time (`CALL_HOURS`); outside them, calls wait and the screen says so.
- When Bolna refuses a call for a passing reason (busy, at its limit, a server error), the same supplier is tried again a minute later, up to three times. Only a refusal about the number itself moves on.
- A call Bolna never reports as finished is given up after 15 minutes, so it can't hold the line forever.
- No supplier can be added until `SUPPLIER_ALLOWLIST` lists their number: the passcode is shared with judges, so it must never let anyone dial a stranger.
- A supplier who says "don't call" is marked on every order, and that number can't be added again.
- Wrong passcodes are limited: 5 per address and 500 in all, per 15 minutes (high enough that nobody can lock the judges out on purpose).
- Browser calls (Desk and practice together) are capped at 30 an hour. Practice calls are labelled practice and run on an agent that Bolna cuts off at 2 minutes.
- Webhooks are accepted only from Bolna's addresses, behind a secret URL. A refused or lost webhook costs a minute, not a call: the cron reads each call's status from Bolna.
- The confirmation call is placed only after Approve, once per order, and never places the order itself.
- A cron every minute recovers calls whose webhook never arrived.
