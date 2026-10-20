import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCallRef, mintWebSession } from '../src/bolna';

afterEach(() => vi.restoreAllMocks());

const config = { apiKey: 'bn-test', baseUrl: 'https://bolna.test' };

describe('mintWebSession', () => {
  it('falls back to the FreeSWITCH mint endpoint when the first answers 404', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/web-call/session')) return new Response('not found', { status: 404 });
      return Response.json({ run_id: 'run_9' });
    });
    const session = await mintWebSession(config, { agentId: 'a', userData: {} });
    expect(session.run_id).toBe('run_9');
    expect(urls).toEqual([
      'https://bolna.test/web-call/session',
      'https://bolna.test/web-call/freeswitch-session',
    ]);
  });

  it('does not retry other errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no credit', { status: 402 }));
    await expect(mintWebSession(config, { agentId: 'a', userData: {} })).rejects.toThrow(/402/);
  });
});

describe('findCallRef', () => {
  it('finds a call id wherever Bolna echoes user_data', () => {
    const id = `call_${'a'.repeat(32)}`;
    expect(findCallRef({ user_data: { call_ref: id } })).toBe(id);
    expect(findCallRef({ recipient_data: { note: id } })).toBe(id);
    expect(findCallRef({ nothing: 'here' })).toBeNull();
  });
});
