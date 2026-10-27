// The custom LLM endpoint Bolna calls on every turn. It asks Groq for the reply, then checks each
// sentence before passing it on: a sentence with a number Bhaav can't back up is never spoken.

import { allowedSet, numbersIn, parseAmount, unbackedNumbers } from './numbers';

/** How long one model may take to start answering before the next one is asked. */
const FIRST_BYTE_MS = 2500;
/** How long an answer may go quiet mid-stream before Bhaav gives up on it. */
const STALL_MS = 4000;
/** Room for the reply after a reasoning model's thinking, which counts against the same cap. */
const MIN_REPLY_TOKENS = 400;

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
  /** Sends one OpenAI-style chat-completions request upstream (Groq); the signal cancels it. */
  upstream: (body: ChatRequest, signal: AbortSignal) => Promise<Response>;
  /** Tried in order; the next one is used when one fails. */
  models: readonly string[];
  /** Numbers this call may state: the quote book, the order and the best offer. */
  allowedFor: (callRef: string | null) => Promise<Iterable<number>>;
  record: (event: CatcherEvent) => Promise<unknown> | undefined;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Non-system messages sent upstream; older turns are dropped. */
  historyLimit?: number;
  /** Overrides FIRST_BYTE_MS and STALL_MS (tests). */
  firstByteMs?: number;
  stallMs?: number;
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
 * both filled in from user_data when Bolna starts the call. An empty one (Bolna leaves an unknown
 * variable blank) is no reference, not the next line's first word.
 */
export function callRefOf(messages: readonly ChatMessage[]): string | null {
  const system = messages.find((m) => m.role === 'system');
  const match = /(?:CALL|REQUEST)_REF:[ \t]*((?:call|req)_[A-Za-z0-9]+)/.exec(
    textOf(system?.content),
  );
  return match?.[1] ?? null;
}

/** Lower case, NFC, and without the Devanagari marks speech-to-text often drops (ऑफ़र is ऑफर). */
const wordKey = (word: string) =>
  word
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u0901\u0902\u093C]/g, '');

const OFFER_WORDS = new Set(
  [
    'offer offers offered other another elsewhere competitor competitors market',
    'doosre dusre doosri dusri doosra dusra mila mili bazaar bazar',
    'ऑफर ऑफ़र आफर दूसरे दूसरी दूसरा मिला मिली बाज़ार बाजार मार्केट',
    'ಆಫರ್ ಬೇರೆ',
  ]
    .join(' ')
    .split(' ')
    .map(wordKey),
);
const OFFER_PHRASES = [
  ['मेरे', 'पास'],
  ['mere', 'paas'],
  ['mere', 'pas'],
  ['कोई', 'और'],
  ['koi', 'aur'],
  ['सबसे', 'कम'],
  ['sabse', 'kam'],
].map(([a = '', b = '']) => [wordKey(a), wordKey(b)] as const);

/**
 * Whether a sentence speaks of an offer from somewhere else ("मेरे पास ₹31 का offer है",
 * "दूसरे supplier ने ₹30 बोला"). Such a sentence may only use numbers Bhaav can prove from the quote
 * book. Otherwise a supplier who says "the other shop said ₹70, na?" could get Bhaav to agree,
 * because ₹70 is a number the supplier said.
 */
export function claimsAnOffer(sentence: string): boolean {
  const words = (sentence.normalize('NFC').match(/[\p{L}\p{M}]+/gu) ?? []).map(wordKey);
  return words.some(
    (word, i) =>
      OFFER_WORDS.has(word) || OFFER_PHRASES.some(([a, b]) => word === a && words[i + 1] === b),
  );
}

/**
 * Groq's reasoning models think before they answer. On a phone call that costs time, and the
 * thinking counts against the same token cap as the answer, so keep it short or off.
 */
export function modelParams(model: string): Record<string, unknown> {
  if (model.startsWith('openai/gpt-oss'))
    return { reasoning_effort: 'low', include_reasoning: false };
  // Qwen answers with tools only when its reasoning is parsed or hidden, never inline.
  if (model.startsWith('qwen/')) return { reasoning_effort: 'none', reasoning_format: 'hidden' };
  return {};
}

/** Resolves with the read, or rejects once the stream has been quiet for `ms`. */
async function readWithin<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const quiet = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the model stopped mid-answer')), ms);
  });
  try {
    return await Promise.race([read, quiet]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
  // The Desk talks to the buyer about their own order, so only prices are checked there; dates
  // and quantities it reads back may not be saved yet.
  const desk = callRef?.startsWith('req_') ?? false;
  const userTexts = req.messages.filter((m) => m.role === 'user').map((m) => textOf(m.content));
  const heard = userTexts.flatMap(numbersIn);
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

  const { stream_options: _ignored, max_completion_tokens: _cap, ...rest } = req;
  const asked = Number(req.max_tokens ?? req.max_completion_tokens) || 0;
  const body: ChatRequest = {
    ...rest,
    messages: trimHistory(req.messages, deps.historyLimit ?? 8),
    stream: true,
    max_tokens: Math.max(asked, MIN_REPLY_TOKENS),
  };

  let upstream: Response | null = null;
  let model = req.model ?? 'bhaav';
  const statuses: number[] = [];
  for (const candidate of deps.models) {
    let status = 0;
    // A model that hangs would leave the phone silent, so it gets a deadline to start answering.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.firstByteMs ?? FIRST_BYTE_MS);
    try {
      const res = await deps.upstream(
        { ...body, ...modelParams(candidate), model: candidate },
        controller.signal,
      );
      if (res.ok && res.body) {
        upstream = res;
        model = candidate;
        break;
      }
      status = res.status;
      res.body?.cancel().catch(() => undefined);
    } catch {
      status = controller.signal.aborted ? 408 : 0;
    } finally {
      clearTimeout(timer);
    }
    statuses.push(status);
    record({ type: 'model_switch', callRef, model: candidate, status });
  }

  const sse = new Sse(model);
  if (!upstream?.body) {
    record({ type: 'upstream_down', callRef, statuses });
    return sseResponse(sse.single(SAFE_LINE));
  }

  const book = await bookNumbers;
  // Numbers Bhaav can prove from the quote book, and those plus what the other person said.
  const proven = allowedSet(book);
  const allowed = allowedSet([...book, ...heard]);
  const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
  const stallMs = deps.stallMs ?? STALL_MS;

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
          const found = unbackedNumbers(sentence, claimsAnOffer(sentence) ? proven : allowed);
          const bad = desk ? found.filter((n) => n.price) : found;
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
            const { value, done } = await readWithin(reader.read(), stallMs);
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

          // A stopped sentence silences the rest of the words, not the tool calls: each has its
          // own check (a save_quote price must be one the supplier said), and dropping the Desk's
          // update_order would lose what the buyer just said.
          if (toolDeltas.length > 0) {
            const bad = assembleToolCalls(toolDeltas).find(
              (call) => call.name === 'save_quote' && !quoteIsBacked(call.arguments, recent),
            );
            if (bad) {
              if (!muted) emit({ content: REPEAT_LINE });
              record({ type: 'tool_blocked', callRef, tool: bad.name, arguments: bad.arguments });
              finish = 'stop';
            } else {
              for (const toolCalls of toolDeltas) emit({ tool_calls: toolCalls });
              finish = 'tool_calls';
            }
          } else if (finish === 'tool_calls') {
            finish = 'stop';
          }
        } catch {
          // The model failed or went quiet mid-answer.
          reader.cancel().catch(() => undefined);
          record({ type: 'upstream_down', callRef, statuses: [408] });
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
