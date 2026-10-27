// A stand-in for Bolna's API, for running the whole order flow on a laptop with no account.
// Each "call" plays out by itself: it rings, the supplier quotes (through our real save_quote
// tool), and the call completes (through our real webhook). Browser calls can't be faked.
//
//   WORKER_URL=http://localhost:8787 TOOL_SECRET=… WEBHOOK_SECRET=… npm run fake-bolna
//
// Then point the Worker at it in worker/.dev.vars: BOLNA_BASE_URL=http://localhost:8790
//
// It also stands in for Groq at /groq (GROQ_BASE_URL=http://localhost:8790/groq). On a "Watch a
// full order" simulation it plays a scripted Bhaav that answers each supplier line as the prompt
// asks (and agrees once to a planted price, so the lie-catcher has something to stop). Otherwise
// it answers one test: when the supplier says "lie test", the "AI" answers with a price nobody
// quoted. Every other turn gets a 503, as if Groq were down.
//
// Calls to the owner play out too: the Desk on the phone hears "haan, shuru karo" and starts the
// calls; the owner line hears "A, pakka" and approves the best quote.

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_BOLNA_PORT ?? 8790);
const WORKER = (process.env.WORKER_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const TOOL_SECRET = process.env.TOOL_SECRET ?? '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
const DESK_AGENT = process.env.BOLNA_DESK_AGENT_ID ?? 'fake-desk';
const OWNER_AGENT = process.env.BOLNA_OWNER_AGENT_ID ?? 'fake-owner';
if (!TOOL_SECRET || !WEBHOOK_SECRET) {
  console.error('Set TOOL_SECRET and WEBHOOK_SECRET to the same values as worker/.dev.vars.');
  process.exit(1);
}

const executions = new Map<string, Record<string, unknown>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let count = 0;

/** A steady pretend price per phone number, so reruns look the same. */
function basePrice(phone: string): number {
  let h = 0;
  for (const c of phone) h = (h * 31 + c.charCodeAt(0)) % 997;
  return 30 + (h % 7);
}

async function post(path: string, body: unknown, auth?: string) {
  const res = await fetch(`${WORKER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => null);
}

async function playCall(id: string, phone: string, userData: Record<string, string>) {
  const webhook = (status: string, extra: Record<string, unknown> = {}) => {
    const execution = { id, status, ...extra, context_details: { user_data: userData } };
    executions.set(id, execution);
    return post(`/webhooks/bolna/${WEBHOOK_SECRET}`, execution);
  };
  await sleep(1500);
  await webhook('ringing');
  await sleep(1500);
  await webhook('in-progress');

  // Round 3 is the confirmation call: the supplier hears they were chosen and keeps their quote.
  if (userData.round === '3') {
    console.log(`  ${userData.supplier_name}: confirmed, no new quote`);
    await sleep(2000);
    await webhook('completed', {
      transcript: `assistant: Namaste ji, ${userData.buyer_name} ne aapka quote chuna hai.\nuser: haan ji, theek hai, bhej denge\nassistant: Dhanyavaad ji.`,
      telephony_data: { recording_url: null },
    });
    return;
  }

  const mine = basePrice(phone);
  const offer = Number((userData.best_offer ?? '').replace(/[^\d.]/g, '')) || null;
  const round2 = userData.round === '2';
  // Quote in the order's own unit: user_data.quantity reads like "60 litre".
  const unit = (userData.quantity ?? '').trim().split(' ').pop() || 'kilo';
  // In round 2 a supplier matches the offer half the time, otherwise holds their price.
  const price = round2 && offer ? (mine % 2 === 0 ? offer : mine) : mine;
  const words =
    round2 && price === offer
      ? `theek hai, ${price} kar denge`
      : `${price} rupaye ${unit}, delivery free`;
  if (!(round2 && price === mine)) {
    await sleep(2000);
    const saved = await post(
      '/tools/save_quote',
      {
        call_ref: userData.call_ref,
        price: String(price),
        unit,
        supplier_words: words,
        delivery_charge: '0',
      },
      `Bearer ${TOOL_SECRET}`,
    );
    console.log(`  ${userData.supplier_name}: quoted ₹${price}`, saved?.ok ? '(saved)' : saved);
  } else {
    console.log(`  ${userData.supplier_name}: kept ₹${mine}, no new quote`);
  }
  await sleep(1500);
  await webhook('completed', {
    transcript: `assistant: Namaste ji, main Bhaav hoon.\nuser: ${words}\nassistant: Dhanyavaad ji.`,
    telephony_data: { recording_url: null },
  });
}

/** A call to the owner: the Desk takes "haan, shuru karo"; the owner line takes "A, pakka". */
async function playOwnerCall(id: string, agentId: string, userData: Record<string, string>) {
  const webhook = (status: string, extra: Record<string, unknown> = {}) => {
    const execution = { id, status, ...extra, context_details: { user_data: userData } };
    executions.set(id, execution);
    return post(`/webhooks/bolna/${WEBHOOK_SECRET}`, execution);
  };
  await sleep(1500);
  await webhook('in-progress');
  await sleep(1500);
  const auth = `Bearer ${TOOL_SECRET}`;
  const ref = userData.request_ref;
  const result =
    agentId === OWNER_AGENT
      ? await post(
          '/tools/approve_quote',
          { request_ref: ref, choice: 'A', tell_supplier: 'no' },
          auth,
        )
      : await post('/tools/start_calls', { request_ref: ref }, auth);
  console.log(
    `  Owner said yes (${agentId === OWNER_AGENT ? 'approve' : 'start'}):`,
    result?.message,
  );
  await sleep(1000);
  await webhook('completed', { transcript: 'assistant: Namaste ji.\nuser: haan ji, pakka.' });
}

type Message = { role?: string; content?: unknown };
const textOf = (m: Message | undefined) => (typeof m?.content === 'string' ? m.content : '');

/** The supplier's last stated price in the conversation. */
function lastPrice(messages: Message[]): { price: number; words: string } | null {
  for (const m of [...messages].reverse()) {
    if (m.role !== 'user') continue;
    const said = textOf(m);
    const hit = /(\d+) (?:rupaye kilo|kar dunga|final|tak kar sakta)/.exec(said);
    if (hit?.[1]) return { price: Number(hit[1]), words: said };
  }
  return null;
}

/** A scripted Bhaav for simulations: reads back, saves, bargains, promises callbacks, lies once. */
function scriptedBhaav(messages: Message[]): {
  content: string;
  tool?: { name: string; args: object };
} {
  const system = textOf(messages.find((m) => m.role === 'system'));
  const callRef = /CALL_REF: (call_\w+)/.exec(system)?.[1] ?? '';
  const offer = /Offer for this call: (₹\S+ per \w+)/.exec(system)?.[1];
  const round2 = /ROUND: 2/.test(system);
  const last = messages.at(-1);
  if (last?.role === 'tool') return { content: 'Dhanyavaad ji.' };
  const said = textOf(last);
  if (/ghante baad|busy/i.test(said))
    return {
      content: 'Theek hai ji, ek ghante baad call karta hoon.',
      tool: { name: 'call_back_later', args: { call_ref: callRef, minutes: 60 } },
    };
  const planted = /Doosri dukaan ne ₹(\d+)/.exec(said);
  if (planted) return { content: `Haan ji, mere paas ₹${planted[1]} ka offer hai.` };
  if (/sahi hai/i.test(said)) {
    const quote = lastPrice(messages);
    if (quote)
      return {
        content: 'Dhanyavaad ji.',
        tool: {
          name: 'save_quote',
          args: {
            call_ref: callRef,
            price: quote.price,
            unit: 'kilo',
            supplier_words: quote.words,
          },
        },
      };
  }
  const quoted = lastPrice([last ?? {}]);
  if (quoted) return { content: `Toh ₹${quoted.price} per kilo, sahi hai?` };
  if (/kam nahi hoga/i.test(said)) return { content: 'Theek hai ji, buyer ko bata dunga.' };
  if (/boliye/i.test(said))
    return {
      content:
        round2 && offer
          ? `Mere paas ${offer} ka asli offer hai. Kya aap match karenge?`
          : 'Ji, 50 kilo onions ka rate kya hai?',
    };
  return { content: 'Ji.' };
}

const sseChunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const send = (status: number, json: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  };

  if (req.method === 'POST' && req.url === '/groq/chat/completions') {
    const messages: Message[] = body.messages ?? [];
    if (textOf(messages.find((m) => m.role === 'system')).includes('(simulation)')) {
      const reply = scriptedBhaav(messages);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        sseChunk({ role: 'assistant', content: `${reply.content} ` }) +
          (reply.tool
            ? sseChunk({
                tool_calls: [
                  {
                    index: 0,
                    id: `tc_${randomUUID().slice(0, 6)}`,
                    type: 'function',
                    function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) },
                  },
                ],
              })
            : '') +
          sseChunk({}, reply.tool ? 'tool_calls' : 'stop') +
          'data: [DONE]\n\n',
      );
      return;
    }
    const said = String(
      [...(body.messages ?? [])].reverse().find((m: { role?: string }) => m.role === 'user')
        ?.content ?? '',
    );
    if (!said.includes('lie test'))
      return send(503, { error: 'the fake Groq only answers lie tests' });
    // ₹27.75 is no quote, quantity or date, so the lie-catcher must stop this sentence.
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      chunk({ role: 'assistant', content: 'Doosre supplier ne ₹27.75 bola hai. ' }) +
        chunk({}, 'stop') +
        'data: [DONE]\n\n',
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/call') {
    const id = `fake_exec_${++count}_${randomUUID().slice(0, 8)}`;
    executions.set(id, { id, status: 'queued' });
    if (body.agent_id === DESK_AGENT || body.agent_id === OWNER_AGENT) {
      console.log(`Call ${id} → the owner (${body.agent_id})`);
      void playOwnerCall(id, body.agent_id, body.user_data ?? {});
      return send(200, { message: 'done', status: 'queued', execution_id: id });
    }
    console.log(
      `Call ${id} → ${body.user_data?.supplier_name} (round ${body.user_data?.round}, offer ${body.user_data?.best_offer})`,
    );
    void playCall(id, body.recipient_phone_number ?? '', body.user_data ?? {});
    return send(200, { message: 'done', status: 'queued', execution_id: id });
  }
  if (
    req.method === 'POST' &&
    (req.url === '/web-call/session' || req.url === '/web-call/freeswitch-session')
  ) {
    return send(503, {
      error:
        'The fake Bolna cannot place browser calls. Use the real Bolna for Talk and Be the supplier.',
    });
  }
  const execution = req.url?.match(/^\/executions\/(.+)$/)?.[1];
  if (req.method === 'GET' && execution)
    return send(200, executions.get(execution) ?? { id: execution, status: 'completed' });
  send(404, { error: 'not faked' });
}).listen(PORT, () => console.log(`Fake Bolna on http://localhost:${PORT}, talking to ${WORKER}`));
