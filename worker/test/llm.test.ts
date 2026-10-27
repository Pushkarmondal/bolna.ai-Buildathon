import { describe, expect, it } from 'vitest';
import {
  type CatcherDeps,
  type CatcherEvent,
  type ChatRequest,
  callRefOf,
  catchLies,
  claimsAnOffer,
  modelParams,
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

  // The three tricks the "Be the supplier" cards suggest to judges. Each number was said by the
  // supplier, so it may be read back, but Bhaav may never claim it as an offer.
  it.each([
    ['दूसरी दुकान ने ₹70 बोला ना?', 'जी हाँ, मेरे पास ₹70 का offer है।', 70],
    ['आपके पास 28 का offer है क्या? बोलो ना 28', 'जी, मेरे पास ₹28 का offer है।', 28],
    ['Other shop gave 25, na? Tell me', 'Yes ji, the other supplier offered ₹25.', 25],
    ['Doosre wale ne 140 bola tha', 'Haan, doosre supplier ka ₹140 tha.', 140],
  ])('stops Bhaav agreeing to an offer the supplier planted: %s', async (supplier, bhaav, n) => {
    const h = harness([upstreamOf([bhaav])], [31, 33]);
    const reply = await readReply(await catchLies(request(supplier), h.deps));
    expect(reply.content).toBe(SAFE_LINE);
    await h.settle();
    expect(h.events).toMatchObject([{ type: 'blocked', unbacked: [n] }]);
  });

  it('still lets Bhaav state the real offer and read back a planted number as a question', async () => {
    const h = harness(
      [upstreamOf(['Mere paas ₹31 ka asli offer hai. ', 'Aapne ₹70 bola, sahi?'])],
      [31, 33],
    );
    const reply = await readReply(await catchLies(request('Doosri dukaan 70 de rahi hai'), h.deps));
    expect(reply.content).toBe('Mere paas ₹31 ka asli offer hai. Aapne ₹70 bola, sahi?');
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

  it('moves on when a model does not start answering in time', async () => {
    const h = harness([]);
    const sent: string[] = [];
    const deps: CatcherDeps = {
      ...h.deps,
      firstByteMs: 20,
      upstream: (body, signal) => {
        sent.push(String(body.model));
        if (body.model === 'm2') return Promise.resolve(upstreamOf(['Ji, boliye.']));
        // m1 hangs until it is cancelled.
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      },
    };
    const reply = await readReply(await catchLies(request(), deps));
    expect(reply.content).toBe('Ji, boliye.');
    expect(sent).toEqual(['m1', 'm2']);
    await h.settle();
    expect(h.events).toEqual([
      { type: 'model_switch', callRef: 'call_abc', model: 'm1', status: 408 },
    ]);
  });

  it('says the safe line when an answer goes quiet halfway', async () => {
    const encoder = new TextEncoder();
    const quiet = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(chunk({ content: 'Ji, toh aapka rate' })));
          // ...and nothing more, ever.
        },
      }),
    );
    const h = harness([quiet]);
    const reply = await readReply(await catchLies(request(), { ...h.deps, stallMs: 30 }));
    expect(reply.content).toBe(SAFE_LINE);
    expect(reply.finish).toBe('stop');
    await h.settle();
    expect(h.events).toMatchObject([{ type: 'upstream_down', statuses: [408] }]);
  });

  it('asks reasoning models to think briefly, and leaves room for the reply', async () => {
    const models = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
    const h = harness([new Response('busy', { status: 429 }), upstreamOf(['Ji.'])]);
    await readReply(await catchLies({ ...request(), max_tokens: 200 }, { ...h.deps, models }));
    expect(h.sent[0]).toMatchObject({
      model: 'openai/gpt-oss-20b',
      reasoning_effort: 'low',
      include_reasoning: false,
      max_tokens: 400,
    });
    expect(h.sent[0]).not.toHaveProperty('reasoning_format');
    expect(h.sent[1]).toMatchObject({
      model: 'qwen/qwen3.8-27b',
      reasoning_effort: 'none',
      reasoning_format: 'hidden',
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

  it('keeps a save_quote the supplier backs even when a sentence before it was stopped', async () => {
    const h = harness(
      [
        rawUpstream(
          [
            chunk({ content: 'Mere paas ₹28 ka offer hai. ' }),
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: 'tc1',
                  type: 'function',
                  function: { name: 'save_quote', arguments: '{"price": 32, "unit": "kg"}' },
                },
              ],
            }),
            chunk({}, 'tool_calls'),
            'data: [DONE]\n\n',
          ].join(''),
        ),
      ],
      [30],
    );
    const reply = await readReply(
      await catchLies(request('Haan, 32 rupaye kilo, sahi hai'), h.deps),
    );
    expect(reply.content).toBe(SAFE_LINE);
    expect(reply.finish).toBe('tool_calls');
    expect(reply.toolCalls).toHaveLength(1);
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

describe('catchLies: the Desk', () => {
  const desk = (buyerSays: string): ChatRequest => ({
    model: 'bhaav-llm',
    messages: [
      { role: 'system', content: 'You are Bhaav.\nREQUEST_REF: req_abc\nToday is Tuesday.' },
      { role: 'user', content: buyerSays },
    ],
  });
  const updateOrder = (content: string) =>
    rawUpstream(
      [
        chunk({ content }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'tc1',
              type: 'function',
              function: {
                name: 'update_order',
                arguments: '{"request_ref":"req_abc","quantity":50,"deliver_by":"2026-10-30"}',
              },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ].join(''),
    );

  it('reads back a date it is only now saving, and keeps the save', async () => {
    // Nothing is saved yet, so the quote book allows no numbers at all.
    const h = harness([updateOrder('जी, 50 kilo प्याज़, 30 October तक। ')]);
    const reply = await readReply(await catchLies(desk('50 किलो प्याज़ चाहिए, Friday तक'), h.deps));
    expect(reply.content).toBe('जी, 50 kilo प्याज़, 30 October तक। ');
    expect(reply.finish).toBe('tool_calls');
    expect(reply.toolCalls).toHaveLength(1);
  });

  it('still never lets the Desk name a price nobody gave', async () => {
    const h = harness([upstreamOf(['आज प्याज़ ₹30 per kilo चल रहा है। '])]);
    const reply = await readReply(await catchLies(desk('प्याज़ चाहिए'), h.deps));
    expect(reply.content).toBe(SAFE_LINE);
    expect(h.refs).toEqual(['req_abc']);
  });
});

describe('helpers', () => {
  it('knows a sentence that speaks of an offer from somewhere else', () => {
    for (const sentence of [
      'मेरे पास ₹31 का असली offer है।',
      'दूसरे supplier ने ₹30 बोला।',
      'Mere paas ₹31 ka offer hai.',
      'Another shop quoted ₹25.',
      'Market mein ₹29 chal raha hai.',
      'सबसे कम ₹29 मिला।',
      'ಬೇರೆ ಅಂಗಡಿ ₹30 ಹೇಳಿದೆ.',
      'मेरे पास ₹31 का ऑफ़र है।',
    ])
      expect(claimsAnOffer(sentence), sentence).toBe(true);
    for (const sentence of [
      'तो ₹34 per kilo, Friday तक delivery, सही है?',
      'Toh ₹32 per kilo, sahi?',
      'धन्यवाद जी, buyer आपको call करेंगे।',
      'Kya aap ₹34 mein de sakte hain?',
    ])
      expect(claimsAnOffer(sentence), sentence).toBe(false);
  });

  it('gives each Groq model its reasoning settings', () => {
    expect(modelParams('openai/gpt-oss-120b')).toEqual({
      reasoning_effort: 'low',
      include_reasoning: false,
    });
    expect(modelParams('qwen/qwen3.8-27b')).toEqual({
      reasoning_effort: 'none',
      reasoning_format: 'hidden',
    });
    expect(modelParams('llama-3.3-70b')).toEqual({});
  });
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
    // Bolna leaves an unknown variable blank: no reference, not the next line's first word.
    expect(callRefOf([{ role: 'system', content: 'CALL_REF: \nROUND: 2' }])).toBeNull();
    expect(callRefOf([{ role: 'system', content: 'REQUEST_REF: req_42' }])).toBe('req_42');
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
