// A stand-in for Bolna's API, for running the whole order flow on a laptop with no account.
// Each "call" plays out by itself: it rings, the supplier quotes (through our real save_quote
// tool), and the call completes (through our real webhook). Browser calls can't be faked.
//
//   WORKER_URL=http://localhost:8787 TOOL_SECRET=… WEBHOOK_SECRET=… npm run fake-bolna
//
// Then point the Worker at it in worker/.dev.vars: BOLNA_BASE_URL=http://localhost:8790

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_BOLNA_PORT ?? 8790);
const WORKER = (process.env.WORKER_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const TOOL_SECRET = process.env.TOOL_SECRET ?? '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
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

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const send = (status: number, json: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  };

  if (req.method === 'POST' && req.url === '/call') {
    const id = `fake_exec_${++count}_${randomUUID().slice(0, 8)}`;
    executions.set(id, { id, status: 'queued' });
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
