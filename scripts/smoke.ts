// Checks a deployed Bhaav from the outside, right after `npm run deploy -w worker`: the pages and
// their security headers, the passcode, each secret (by the door it opens), Groq through the real
// lie-catcher, and the screens' API. Read-only except for one AI turn, which writes a transcript
// line with no order. Add --simulate to also play one whole "Watch a full order" (about 40 Groq
// calls), which proves the AI follows the script well enough to save quotes and bargain.
//
//   BHAAV_URL=https://bhaav.<you>.workers.dev APP_PASSCODE=… LLM_SECRET=… TOOL_SECRET=… \
//   npm run smoke [-- --simulate]
//
// The secrets come from your shell, never from this file; nothing is printed back.

const BASE = (process.env.BHAAV_URL ?? '').replace(/\/+$/, '');
const simulate = process.argv.includes('--simulate');
const missing = ['BHAAV_URL', 'APP_PASSCODE', 'LLM_SECRET', 'TOOL_SECRET'].filter(
  (name) => !process.env[name]?.trim(),
);
if (missing.length) {
  console.error(`Set ${missing.join(', ')}. See the comment at the top of scripts/smoke.ts.`);
  process.exit(1);
}

let failed = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function call(path: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
}
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

// 1. The app and its headers.
const home = await call('/');
check(home.status === 200, 'the app opens', `HTTP ${home.status}`);
check((await home.text()).includes('<div id="root">'), 'the built web app is served');
for (const h of ['x-content-type-options', 'x-frame-options', 'referrer-policy'])
  check(home.headers.has(h), `the page sends ${h}`);
const deep = await call('/r/req_smoke_test_deep_link');
check(
  deep.status === 200,
  'a deep link loads the app (single-page fallback)',
  `HTTP ${deep.status}`,
);
const health = await call('/api/health');
check(health.status === 200, 'the Worker answers /api/health', `HTTP ${health.status}`);

// 2. The passcode (COOKIE_SECRET and APP_PASSCODE).
const wrong = await call('/api/auth', json({ passcode: 'definitely-not-it' }));
check(wrong.status === 401, 'a wrong passcode is refused', `HTTP ${wrong.status}`);
const right = await call('/api/auth', json({ passcode: process.env.APP_PASSCODE }));
check(right.status === 200, 'the passcode opens the app', `HTTP ${right.status}`);
const cookie = (right.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
check(cookie.startsWith('bhaav_session='), 'a session cookie is set');
const withSession = { cookie };

// 3. Each secret, by the door it opens.
check((await call('/v1/models')).status === 401, 'the custom LLM refuses a request with no key');
const models = await call('/v1/models', {
  headers: { authorization: `Bearer ${process.env.LLM_SECRET}` },
});
check(
  models.status === 200,
  'LLM_SECRET opens the custom LLM (what Bolna checks on save)',
  `HTTP ${models.status}`,
);
check(
  (await call('/tools/save_quote', json({ call_ref: 'call_none' }))).status === 401,
  'the tools refuse a call with no secret',
);
const tool = await call(
  '/tools/save_quote',
  json({ call_ref: 'call_none' }, { authorization: `Bearer ${process.env.TOOL_SECRET}` }),
);
check(tool.status === 200, 'TOOL_SECRET opens the tools (what Bolna sends)', `HTTP ${tool.status}`);
check(
  (await call('/webhooks/bolna/not-the-secret', json({ id: 'x', status: 'completed' }))).status ===
    404,
  'the webhook hides behind its secret',
);

// 4. Groq, through the real lie-catcher (one AI turn).
const turn = await call(
  '/v1/chat/completions',
  json(
    {
      model: 'bhaav-llm',
      stream: true,
      messages: [
        {
          role: 'system',
          content: 'You are Bhaav, a polite buying assistant. Answer in one short sentence.',
        },
        { role: 'user', content: 'Namaste ji, kaise ho?' },
      ],
    },
    { authorization: `Bearer ${process.env.LLM_SECRET}` },
  ),
);
const said = (await turn.text())
  .split('\n')
  .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
  .map((l) => JSON.parse(l.slice(6)).choices?.[0]?.delta?.content ?? '')
  .join('')
  .trim();
check(
  turn.status === 200 && said !== '' && !said.startsWith('Ek second ji'),
  'Groq answers through the lie-catcher (GROQ_API_KEY and GROQ_MODELS work)',
  said ? `said: "${said.slice(0, 60)}"` : `HTTP ${turn.status}, no words`,
);

// 5. The screens' API.
for (const path of ['/api/requests/req_none', '/api/proof', '/api/break-bhaav', '/api/schedules']) {
  const res = await call(path, { headers: withSession });
  const expect = path.endsWith('req_none') ? 404 : 200;
  check(res.status === expect, `${path} answers`, `HTTP ${res.status}`);
}
const personas = await call('/api/practice/personas', { headers: withSession });
check(
  personas.status === 200 && ((await personas.json()) as unknown[]).length === 3,
  'the three practice suppliers are there',
);

// 6. Optional: one whole simulated order, with the real AI.
if (simulate) {
  const start = await call('/api/simulations', { method: 'POST', headers: withSession });
  const body = (await start.json()) as { id?: string; error?: string };
  check(start.status === 201 || Boolean(body.id), 'a simulation starts', body.error ?? '');
  let step = '';
  type SimView = {
    order: { status: string };
    quotes: unknown[];
    turns: Array<{ stopped: string | null; said: string }>;
  };
  let view: SimView | null = null;
  for (let i = 0; i < 160 && step !== 'done' && body.id; i++) {
    const res = await call(`/api/simulations/${body.id}/step`, {
      method: 'POST',
      headers: withSession,
    });
    const out = (await res.json()) as { step?: string; view?: SimView; error?: string };
    if (res.status !== 200) {
      check(false, 'a simulation step', out.error ?? `HTTP ${res.status}`);
      break;
    }
    step = out.step ?? '';
    view = out.view ?? view;
    process.stdout.write('.');
  }
  console.log('');
  check(step === 'done', 'the simulation reaches the end', `${view?.turns.length ?? 0} turns`);
  check(
    (view?.quotes.length ?? 0) >= 4,
    'the AI saved quotes',
    `${view?.quotes.length ?? 0} quotes`,
  );
  const safeLines = view?.turns.filter((t) => t.said.startsWith('Ek second ji')).length ?? 0;
  console.log(
    `      ${view?.turns.filter((t) => t.stopped).length ?? 0} sentences stopped by the lie-catcher, ${safeLines} safe lines (each is a stop or a busy AI)`,
  );
  console.log(`      Open it: ${BASE}/r/${body.id}`);
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nEverything checked passes.');
process.exitCode = failed ? 1 : 0;

// A module, so the checks above can await at the top level.
export {};
