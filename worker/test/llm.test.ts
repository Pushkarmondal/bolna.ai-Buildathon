import { describe, expect, it } from 'vitest';
import {
  type CatcherDeps,
  type CatcherEvent,
  type ChatRequest,
  callRefOf,
  catchLies,
  REPEAT_LINE,
  SAFE_LINE,
  splitSentences,
  trimHistory,
} from '../src/llm';

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** An upstream SSE response from text pieces, re-split at arbitrary points like a real network. */
function upstreamOf(pieces: string[], { finish = 'stop', splitEvery = 7 } = {}): Response {
  const raw = [
    ...pieces.map((p) => chunk({ content: p })),
    chunk({}, finish),
    'data: [DONE]\n\n',
  ].join('');
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < raw.length; i += splitEvery)
          controller.enqueue(encoder.encode(raw.slice(i, i + splitEvery)));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function rawUpstream(raw: string): Response {
  return new Response(raw, { headers: { 'content-type': 'text/event-stream' } });
}

async function readReply(res: Response) {
  const raw = await res.text();
  let content = '';
  const toolCalls: unknown[] = [];
  let finish: string | null = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    const choice = JSON.parse(line.slice(6)).choices[0];
    if (typeof choice.delta.content === 'string') content += choice.delta.content;
    if (choice.delta.tool_calls) toolCalls.push(...choice.delta.tool_calls);
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  return { raw, content, toolCalls, finish };
}

function harness(responses: Array<Response | Error>, allowed: number[] = []) {
  const events: CatcherEvent[] = [];
  const pending: Promise<unknown>[] = [];
  const sent: ChatRequest[] = [];
  const refs: Array<string | null> = [];
  let i = 0;
  const deps: CatcherDeps = {
    models: ['m1', 'm2', 'm3'],
    upstream: async (body) => {
      sent.push(body);
      const next = responses[i++] ?? new Response('busy', { status: 429 });
      if (next instanceof Error) throw next;
      return next;
    },
    allowedFor: async (ref) => {
      refs.push(ref);
      return allowed;
    },
    record: async (e) => {
      events.push(e);
    },
    waitUntil: (p) => pending.push(p),
  };
  return { deps, events, sent, refs, settle: () => Promise.all(pending) };
}

const request = (supplierSays = 'Haan ji, boliye.'): ChatRequest => ({
  model: 'bhaav-llm',
  stream: true,
  stream_options: { include_usage: true },
  messages: [
    { role: 'system', content: 'You are Bhaav.\nCALL_REF: call_abc\nNeed: 50 kg onions.' },
    { role: 'assistant', content: 'Namaste ji, main Bhaav hoon.' },
    { role: 'user', content: supplierSays },
  ],
});

describe('catchLies: sentences', () => {
  it('passes backed sentences through word for word', async () => {
    const h = harness(
      [upstreamOf(['Mere paas ₹30 ka ', 'asli offer hai. ', 'Kya aap match karenge?'])],
      [30],
    );
    const reply = await readReply(await catchLies(request(), h.deps));
    expect(reply.content).toBe('Mere paas ₹30 ka asli offer hai. Kya aap match karenge?');
    expect(reply.finish).toBe('stop');
    await h.settle();
    expect(h.events).toEqual([]);
  });

  it('blocks a sentence with an unbacked price and says nothing after it', async () => {
    const h = harness([upstreamOf(['Mere paas ₹27 ka offer hai. ', 'Aap kitna denge?'])], [30]);
    const reply = await readReply(await catchLies(request(), h.deps));
    expect(reply.content).toBe(SAFE_LINE);
    // Only the spoken text: the raw stream carries a random id that may contain "27".
    expect(reply.content).not.toContain('27');
    await h.settle();
    expect(h.events).toEqual([
      {
        type: 'blocked',
        callRef: 'call_abc',
        sentence: 'Mere paas ₹27 ka offer hai.',
        unbacked: [27],
      },
    ]);
  });

  it('checks a number split across stream chunks', async () => {
    const h = harness([upstreamOf(['Toh ₹3', '0 per ki', 'lo. '])]);
    const reply = await readReply(await catchLies(request(), h.deps));
    expect(reply.content).toBe(SAFE_LINE);
  });

  it('lets Bhaav repeat a price the supplier just said', async () => {
    const h = harness([upstreamOf(['Toh ₹32 per kilo, sahi? '])]);
    const reply = await readReply(await catchLies(request('Bhai 32 rupaye kilo lagega'), h.deps));
    expect(reply.content).toBe('Toh ₹32 per kilo, sahi? ');
  });

  it('checks the last sentence even without a full stop', async () => {
    const h = harness([upstreamOf(['Theek hai. Toh 45 final'])]);
    const reply = await readReply(await catchLies(request(), h.deps));
    expect(reply.content).toBe(`Theek hai. ${SAFE_LINE}`);
  });

  it('reads a last SSE line that has no trailing newline', async () => {
    const h = harness([rawUpstream(`${chunk({ content: 'Dhanyavaad ji.' })}data: [DONE]`)]);
    const reply = await readReply(await catchLies(request(), h.deps));
    expect(reply.content).toBe('Dhanyavaad ji.');
  });

  it('allows nothing extra when the quote book read fails', async () => {
    const h = harness([upstreamOf(['Mere paas ₹30 ka offer hai. '])], [30]);
    const failing = {
      ...h.deps,
      allowedFor: async () => {
        throw new Error('D1 down');
      },
    };
    const reply = await readReply(await catchLies(request(), failing));
    expect(reply.content).toBe(SAFE_LINE);
  });
});

describe('catchLies: models', () => {
  it('moves to the next model on a 429 and records it', async () => {
    const h = harness([new Response('busy', { status: 429 }), upstreamOf(['Ji, boliye.'])]);
    const reply = await readReply(await catchLies(request(), h.deps));
    expect(reply.content).toBe('Ji, boliye.');
    expect(h.sent.map((b) => b.model)).toEqual(['m1', 'm2']);
    await h.settle();
    expect(h.events).toEqual([
      { type: 'model_switch', callRef: 'call_abc', model: 'm1', status: 429 },
    ]);
  });

  it('speaks the safe line instead of going silent when every model fails', async () => {
    const h = harness([
      new Response('x', { status: 429 }),
      new Error('network'),
      new Response('x', { status: 500 }),
    ]);
    const reply = await readReply(await catchLies(request(), h.deps));
    expect(reply.content).toBe(SAFE_LINE);
    expect(reply.finish).toBe('stop');
    await h.settle();
    expect(h.events.at(-1)).toEqual({
      type: 'upstream_down',
      callRef: 'call_abc',
      statuses: [429, 0, 500],
    });
  });

  it('sends a trimmed, streaming request upstream and looks up the call', async () => {
    const h = harness([upstreamOf(['Ji.'])]);
    const long: ChatRequest = {
      ...request(),
      messages: [
        { role: 'system', content: 'CALL_REF: call_xyz' },
        ...Array.from({ length: 12 }, (_, n) => ({
          role: n % 2 ? 'user' : 'assistant',
          content: `turn ${n}`,
        })),
      ],
    };
    await readReply(await catchLies(long, { ...h.deps, historyLimit: 4 }));
    const body = h.sent[0];
    expect(body?.stream).toBe(true);
    expect(body).not.toHaveProperty('stream_options');
    expect(body?.messages.map((m) => m.content)).toEqual([
      'CALL_REF: call_xyz',
      'turn 8',
      'turn 9',
      'turn 10',
      'turn 11',
    ]);
    expect(h.refs).toEqual(['call_xyz']);
  });
});

describe('catchLies: tool calls', () => {
  const saveQuote = (args: string, split = 10) => {
    const pieces: string[] = [];
    for (let i = 0; i < args.length; i += split) pieces.push(args.slice(i, i + split));
    return rawUpstream(
      [
        chunk({ content: 'Theek hai ji. ' }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'tc1',
              type: 'function',
              function: { name: 'save_quote', arguments: '' },
            },
          ],
        }),
        ...pieces.map((p) => chunk({ tool_calls: [{ index: 0, function: { arguments: p } }] })),
        chunk({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ].join(''),
    );
  };

  it('passes save_quote through when the supplier said that price', async () => {
    const h = harness([saveQuote('{"price": 32, "unit": "kg"}')]);
    const reply = await readReply(
      await catchLies(request('Haan, 32 rupaye kilo, sahi hai'), h.deps),
    );
    expect(reply.content).toBe('Theek hai ji. ');
    expect(reply.finish).toBe('tool_calls');
    const args = reply.toolCalls
      .map((t) => (t as { function?: { arguments?: string } }).function?.arguments ?? '')
      .join('');
    expect(JSON.parse(args)).toEqual({ price: 32, unit: 'kg' });
  });

  it('reads a price written as "₹2,250" the same way the save_quote handler does', async () => {
    const h = harness([saveQuote('{"price": "₹2,250", "unit": "pack"}')]);
    const reply = await readReply(
      await catchLies(request('Do hazaar do sau pachaas ka ek tin, delivery free'), h.deps),
    );
    expect(reply.finish).toBe('tool_calls');
    expect(reply.content).toBe('Theek hai ji. ');
  });

  it('asks again instead of saving a price the supplier never said', async () => {
    const h = harness([saveQuote('{"price": 23, "unit": "kg"}')]);
    const reply = await readReply(
      await catchLies(request('Haan, 32 rupaye kilo, sahi hai'), h.deps),
    );
    expect(reply.content).toBe(`Theek hai ji. ${REPEAT_LINE}`);
    expect(reply.toolCalls).toEqual([]);
    expect(reply.finish).toBe('stop');
    await h.settle();
    expect(h.events[0]).toMatchObject({ type: 'tool_blocked', tool: 'save_quote' });
  });
});

describe('helpers', () => {
  it('splits sentences but not "Rs. 32" or decimals', () => {
    expect(splitSentences('Rs. 32.50 hai. Theek?')).toEqual({
      sentences: ['Rs. 32.50 hai. '],
      rest: 'Theek?',
    });
    expect(splitSentences('Ek.\nDo')).toEqual({ sentences: ['Ek.\n'], rest: 'Do' });
    expect(splitSentences('कितना? ठीक।  हाँ')).toEqual({
      sentences: ['कितना? ', 'ठीक।  '],
      rest: 'हाँ',
    });
  });

  it('finds CALL_REF in the system prompt', () => {
    expect(
      callRefOf([{ role: 'system', content: [{ type: 'text', text: 'CALL_REF: call_9' }] }]),
    ).toBe('call_9');
    expect(callRefOf([{ role: 'user', content: 'CALL_REF: call_9' }])).toBeNull();
  });

  it('never starts the kept history on a tool result', () => {
    const kept = trimHistory(
      [
        { role: 'system', content: 's' },
        { role: 'assistant', content: 'a', tool_calls: [{}] },
        { role: 'tool', content: 't' },
        { role: 'user', content: 'u' },
      ],
      2,
    );
    expect(kept.map((m) => m.role)).toEqual(['system', 'user']);
  });
});
