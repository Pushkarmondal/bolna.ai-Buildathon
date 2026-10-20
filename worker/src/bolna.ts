// The three Bolna API calls the Worker makes: place a phone call, mint a browser-call session,
// and read an execution (a call's status, transcript and recording).

export interface BolnaConfig {
  apiKey: string;
  baseUrl: string;
}

export class BolnaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

/** A call as Bolna reports it, in GET /executions/{id} and in every webhook. */
export interface Execution {
  id: string;
  status: string;
  transcript?: string | null;
  telephony_data?: { recording_url?: string | null } | null;
  context_details?: unknown;
  error_message?: string | null;
}

async function request<T>(config: BolnaConfig, path: string, init?: RequestInit): Promise<T> {
  if (!config.apiKey) throw new BolnaError('BOLNA_API_KEY is not set', 0, '');
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const body = await res.text();
  if (!res.ok) throw new BolnaError(`Bolna ${path} answered ${res.status}`, res.status, body);
  return JSON.parse(body) as T;
}

export function placeCall(
  config: BolnaConfig,
  call: { agentId: string; phone: string; fromNumber?: string; userData: Record<string, string> },
): Promise<{ execution_id: string; status: string }> {
  return request(config, '/call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: call.agentId,
      recipient_phone_number: call.phone,
      ...(call.fromNumber ? { from_phone_number: call.fromNumber } : {}),
      user_data: call.userData,
    }),
  });
}

/**
 * A single-use, ~120-second session the browser's Web Call SDK connects with. Bolna's docs name
 * the mint endpoint /web-call/session and the SDK's README /web-call/freeswitch-session, so try
 * the first and fall back to the second on a 404.
 */
export async function mintWebSession(
  config: BolnaConfig,
  session: { agentId: string; userData: Record<string, string> },
): Promise<Record<string, unknown> & { run_id?: string }> {
  const init = {
    method: 'POST',
    body: JSON.stringify({ agent_id: session.agentId, user_data: session.userData }),
  };
  try {
    return await request(config, '/web-call/session', init);
  } catch (error) {
    if (error instanceof BolnaError && error.status === 404) {
      return request(config, '/web-call/freeswitch-session', init);
    }
    throw error;
  }
}

export function getExecution(config: BolnaConfig, executionId: string): Promise<Execution> {
  return request(config, `/executions/${encodeURIComponent(executionId)}`);
}

/** Finds a `call_…` id anywhere inside a payload's context details (where Bolna echoes user_data). */
export function findCallRef(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'string') return /^call_[a-f0-9]{32}$/.test(value) ? value : null;
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.call_ref === 'string') return record.call_ref;
  for (const v of Object.values(record)) {
    const found = findCallRef(v, depth + 1);
    if (found) return found;
  }
  return null;
}
