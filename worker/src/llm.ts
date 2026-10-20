// The custom LLM endpoint Bolna calls on every turn. It asks Groq for the reply, then checks each
// sentence before passing it on: a sentence with a number Bhaav can't back up is never spoken.

import { allowedSet, numbersIn, parseAmount, unbackedNumbers } from './numbers';

export interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

export type CatcherEvent =
  | { type: 'blocked'; callRef: string | null; sentence: string; unbacked: number[] }
  | { type: 'tool_blocked'; callRef: string | null; tool: string; arguments: string }
  | { type: 'model_switch'; callRef: string | null; model: string; status: number }
  | { type: 'upstream_down'; callRef: string | null; statuses: number[] };

export interface CatcherDeps {
  /** Sends one OpenAI-style chat-completions request upstream (Groq). */
  upstream: (body: ChatRequest) => Promise<Response>;
  /** Tried in order; the next one is used when one fails. */
  models: readonly string[];
  /** Numbers this call may state: the quote book, the order and the best offer. */
  allowedFor: (callRef: string | null) => Promise<Iterable<number>>;
  record: (event: CatcherEvent) => Promise<unknown> | undefined;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Non-system messages sent upstream; older turns are dropped. */
  historyLimit?: number;
}

export const SAFE_LINE = 'Ek second ji, main apne notes check karta hoon.';
export const REPEAT_LINE = 'Maaf kijiye, ek baar rate phir se bata dijiye?';

/** How many of the supplier's latest messages a save_quote price must appear in. */
const RECENT_USER_MESSAGES = 3;

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
          ? part.text
          : '',
      )
      .join(' ');
  }
  return '';
}

/**
 * The Caller's prompt carries `CALL_REF: <call id>` and the Desk's `REQUEST_REF: <order id>`,
 * both filled in from user_data when Bolna starts the call.
 */
export function callRefOf(messages: readonly ChatMessage[]): string | null {
  const system = messages.find((m) => m.role === 'system');
  const match = /(?:CALL|REQUEST)_REF:\s*([A-Za-z0-9_-]+)/.exec(textOf(system?.content));
  return match?.[1] ?? null;
}

/** System messages plus the last `limit` others, never starting on an orphaned tool result. */
export function trimHistory(messages: readonly ChatMessage[], limit: number): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  let tail = messages.filter((m) => m.role !== 'system').slice(-limit);
  while (tail[0]?.role === 'tool') tail = tail.slice(1);
  return [...system, ...tail];
}

/** Cuts complete sentences off the front of a buffer; "Rs. 32" and "32.50" are not sentence ends. */
export function splitSentences(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    const next = text[i + 1];
    const stop =
      c === '\n' ||
      ('.!?।'.includes(c) &&
        next !== undefined &&
        /\s/.test(next) &&
        !(c === '.' && /\brs$/i.test(text.slice(start, i))));
    if (!stop) continue;
    let end = i + 1;
    while (end < text.length && /\s/.test(text[end] ?? '')) end++;
    sentences.push(text.slice(start, end));
    start = end;
    i = end - 1;
  }
  return { sentences, rest: text.slice(start) };
}

interface ToolCallDelta {
  index?: number;
  function?: { name?: string; arguments?: string };
}

function assembleToolCalls(
  deltas: readonly unknown[][],
): Array<{ name: string; arguments: string }> {
  const calls: Array<{ name: string; arguments: string }> = [];
  for (const list of deltas) {
    for (const raw of list) {
      const d = raw as ToolCallDelta;
      const index = d.index ?? 0;
      const call = calls[index] ?? { name: '', arguments: '' };
      if (d.function?.name) call.name = d.function.name;
      call.arguments += d.function?.arguments ?? '';
      calls[index] = call;
    }
  }
  return calls.filter(Boolean);
}

/** A save_quote price must be a number the supplier actually said in their last few messages. */
function quoteIsBacked(args: string, recent: ReadonlySet<number>): boolean {
  try {
    const price = parseAmount((JSON.parse(args) as { price?: unknown }).price);
    return price !== undefined && recent.has(Math.round(price * 100) / 100);
  } catch {
    return false;
  }
}

class Sse {
  private readonly id = `chatcmpl-bhaav-${crypto.randomUUID()}`;
  private readonly created = Math.floor(Date.now() / 1000);
  private readonly encoder = new TextEncoder();
  constructor(private readonly model: string) {}

  chunk(delta: Record<string, unknown>, finishReason: string | null = null): Uint8Array {
    const body = {
      id: this.id,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    return this.encoder.encode(`data: ${JSON.stringify(body)}\n\n`);
  }

  done(): Uint8Array {
    return this.encoder.encode('data: [DONE]\n\n');
  }

  /** A whole reply of one line, for when no model answered. */
  single(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        controller.enqueue(this.chunk({ role: 'assistant', content: text }));
        controller.enqueue(this.chunk({}, 'stop'));
        controller.enqueue(this.done());
        controller.close();
      },
    });
  }
}

function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

/** Handles one chat-completions request from Bolna and returns the checked reply as an SSE stream. */
export async function catchLies(req: ChatRequest, deps: CatcherDeps): Promise<Response> {
  const callRef = callRefOf(req.messages);
  const userTexts = req.messages.filter((m) => m.role === 'user').map((m) => textOf(m.content));
  const fromSupplier = userTexts.flatMap(numbersIn);
  // Read the quote book while Groq starts on the reply. A failed read allows fewer numbers, not more.
  const bookNumbers = Promise.resolve()
    .then(() => deps.allowedFor(callRef))
    .then((values) => [...values])
    .catch((): number[] => []);
  const recent = allowedSet(userTexts.slice(-RECENT_USER_MESSAGES).flatMap(numbersIn));

  const record = (event: CatcherEvent) => {
    const pending = Promise.resolve()
      .then(() => deps.record(event))
      .catch(() => undefined);
    deps.waitUntil?.(pending);
  };

  const { stream_options: _ignored, ...rest } = req;
  const body: ChatRequest = {
    ...rest,
    messages: trimHistory(req.messages, deps.historyLimit ?? 8),
    stream: true,
  };

  let upstream: Response | null = null;
  let model = req.model ?? 'bhaav';
  const statuses: number[] = [];
  for (const candidate of deps.models) {
    let status = 0;
    try {
      const res = await deps.upstream({ ...body, model: candidate });
      if (res.ok && res.body) {
        upstream = res;
        model = candidate;
        break;
      }
      status = res.status;
      res.body?.cancel().catch(() => undefined);
    } catch {
      status = 0;
    }
    statuses.push(status);
    record({ type: 'model_switch', callRef, model: candidate, status });
  }

  const sse = new Sse(model);
  if (!upstream?.body) {
    record({ type: 'upstream_down', callRef, statuses });
    return sseResponse(sse.single(SAFE_LINE));
  }

  const allowed = allowedSet([...(await bookNumbers), ...fromSupplier]);
  const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();

  return sseResponse(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let lines = '';
        let text = '';
        let muted = false;
        let spoke = false;
        let finish: string | null = null;
        const toolDeltas: unknown[][] = [];

        const emit = (delta: Record<string, unknown>) => {
          controller.enqueue(sse.chunk(spoke ? delta : { role: 'assistant', ...delta }));
          spoke = true;
        };
        const say = (sentence: string) => {
          if (muted || sentence.trim() === '') return;
          const bad = unbackedNumbers(sentence, allowed);
          if (bad.length > 0) {
            muted = true;
            emit({ content: SAFE_LINE });
            record({
              type: 'blocked',
              callRef,
              sentence: sentence.trim(),
              unbacked: bad.map((n) => n.value),
            });
            return;
          }
          emit({ content: sentence });
        };

        try {
          read: while (true) {
            const { value, done } = await reader.read();
            // A final line without its newline still counts.
            lines += done ? '\n' : value;
            let newline = lines.indexOf('\n');
            while (newline >= 0) {
              const line = lines.slice(0, newline).trim();
              lines = lines.slice(newline + 1);
              newline = lines.indexOf('\n');
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (data === '[DONE]') break read;

              let parsed: {
                choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>;
              };
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              const choice = parsed.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta ?? {};
              if (typeof delta.content === 'string' && delta.content !== '') {
                text += delta.content;
                const split = splitSentences(text);
                text = split.rest;
                for (const sentence of split.sentences) say(sentence);
              }
              if (Array.isArray(delta.tool_calls)) toolDeltas.push(delta.tool_calls);
              if (choice.finish_reason) finish = choice.finish_reason;
            }
            if (done) break;
          }
          say(text);

          if (toolDeltas.length > 0) {
            if (muted) {
              finish = 'stop';
            } else {
              const bad = assembleToolCalls(toolDeltas).find(
                (call) => call.name === 'save_quote' && !quoteIsBacked(call.arguments, recent),
              );
              if (bad) {
                emit({ content: REPEAT_LINE });
                record({ type: 'tool_blocked', callRef, tool: bad.name, arguments: bad.arguments });
                finish = 'stop';
              } else {
                for (const toolCalls of toolDeltas) emit({ tool_calls: toolCalls });
                finish = 'tool_calls';
              }
            }
          } else if (finish === 'tool_calls') {
            finish = 'stop';
          }
        } catch {
          if (!muted) emit({ content: SAFE_LINE });
          finish = 'stop';
        }

        if (!spoke) emit({ content: '' });
        controller.enqueue(sse.chunk({}, finish ?? 'stop'));
        controller.enqueue(sse.done());
        controller.close();
      },
      cancel() {
        reader.cancel().catch(() => undefined);
      },
    }),
  );
}
