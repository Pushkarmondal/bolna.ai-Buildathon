// Sets Bhaav up in Bolna: registers the Worker as a custom LLM, then creates (or updates) the
// Desk, the Caller, and the practice Caller (the Caller cut off at two minutes, for judges).
// Run after the Worker is deployed.
//
//   BOLNA_API_KEY=… WORKER_URL=https://bhaav.<you>.workers.dev LLM_SECRET=… TOOL_SECRET=… \
//   WEBHOOK_SECRET=… npm run agents:setup
//
// Optional: DESK_AGENT_ID / CALLER_AGENT_ID / PRACTICE_AGENT_ID to update existing agents instead
// of creating new ones; SARVAM_VOICE_ID and SARVAM_VOICE_NAME to pick another bulbul:v4-flash voice.
// `npm run agents:print` writes the request bodies to bolna/ with secrets masked, and calls nothing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { type AgentSetup, agentBody, dashboardTools } from '../worker/src/agents';

const BOLNA = 'https://api.bolna.ai';
const LLM_MODEL = 'bhaav-llm';
const dry = process.argv.includes('--dry');
// --graph builds the Caller as a Bolna Graph Agent (steps and routing) instead of one prompt.
const graph = process.argv.includes('--graph');
const callerKind = graph ? 'caller-graph' : 'caller';

function need(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (dry) return `<${name}>`;
  console.error(`Missing ${name}. See the comment at the top of scripts/setup-agents.ts.`);
  process.exit(1);
}

const setup: AgentSetup = {
  workerUrl: need('WORKER_URL').replace(/\/+$/, ''),
  llmModel: LLM_MODEL,
  toolSecret: dry ? '<TOOL_SECRET>' : need('TOOL_SECRET'),
  webhookSecret: dry ? '<WEBHOOK_SECRET>' : need('WEBHOOK_SECRET'),
  voice: {
    id: process.env.SARVAM_VOICE_ID?.trim() || 'aparna_hi_customer',
    name: process.env.SARVAM_VOICE_NAME?.trim() || 'Aparna (Customer)',
  },
};

if (dry) {
  mkdirSync('bolna', { recursive: true });
  for (const kind of ['desk', 'caller', 'caller-graph', 'practice'] as const) {
    writeFileSync(
      `bolna/${kind}-agent.json`,
      `${JSON.stringify(agentBody(kind, setup), null, 2)}\n`,
    );
    if (kind !== 'desk' && kind !== 'caller') continue;
    writeFileSync(
      `bolna/${kind}-tools.json`,
      `${JSON.stringify(dashboardTools(kind, setup), null, 2)}\n`,
    );
  }
  console.log(
    'Wrote bolna/desk-agent.json, bolna/caller-agent.json, bolna/caller-graph-agent.json, bolna/practice-agent.json and the *-tools.json files (secrets masked). The practice agent uses the Caller tools.',
  );
  process.exit(0);
}

const apiKey = need('BOLNA_API_KEY');

async function bolna(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BOLNA}${path}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // keep the text
  }
  return { ok: res.ok, status: res.status, json };
}

// 1. Register the Worker as a custom LLM. Bolna checks GET /v1/models with the key when saving.
const model = await bolna('POST', '/user/model/custom', {
  custom_model_name: LLM_MODEL,
  custom_model_url: `${setup.workerUrl}/v1`,
  custom_model_key: need('LLM_SECRET'),
  custom_model_family: 'openai',
});
if (model.ok) console.log(`Registered the custom LLM "${LLM_MODEL}".`);
else
  console.warn(
    `Custom LLM not registered (${model.status}); if it already exists this is fine:`,
    model.json,
  );

// 2. Create or update each agent.
const AGENTS = [
  { kind: 'desk', label: 'Desk', idVar: 'DESK_AGENT_ID', setting: 'BOLNA_DESK_AGENT_ID' },
  { kind: callerKind, label: 'Caller', idVar: 'CALLER_AGENT_ID', setting: 'BOLNA_CALLER_AGENT_ID' },
  {
    kind: 'practice',
    label: 'Practice Caller',
    idVar: 'PRACTICE_AGENT_ID',
    setting: 'BOLNA_PRACTICE_AGENT_ID',
  },
] as const;
for (const { kind, label, idVar, setting } of AGENTS) {
  const existing = process.env[idVar]?.trim();
  const body = agentBody(kind, setup);
  const res = existing
    ? await bolna('PUT', `/v2/agent/${existing}`, body)
    : await bolna('POST', '/v2/agent', body);
  if (!res.ok) {
    console.error(`\nBolna refused the ${label} agent (${res.status}):`, res.json);
    console.error(
      'Run `npm run agents:print` and create it in the dashboard from bolna/*.json instead.',
    );
    process.exit(1);
  }
  const id = existing ?? (res.json as { agent_id?: string }).agent_id;
  console.log(`${label} agent ${existing ? 'updated' : 'created'}: ${setting} = "${id}"`);
}

console.log(`
Next:
  1. Put the three ids in worker/wrangler.toml (the lines printed above).
  2. npm run build && npm run deploy -w worker
  3. In Bolna, place one test call from each agent before any real supplier call.`);
