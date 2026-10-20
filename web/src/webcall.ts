// A React wrapper around Bolna's Web Call SDK. The session is minted by our Worker
// (POST /api/web-session), which chooses the agent and fills its variables, so the
// browser never sees the Bolna key.

import type { BolnaWebCall, CallState, Session } from '@bolna/web-call';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export type SessionRequest =
  | { kind: 'desk'; requestId: string }
  | { kind: 'practice'; personaId: string };

interface Minted {
  session: Session;
  /** Set for practice calls: the practice order and call the review screen reads. */
  requestId?: string;
  callId?: string;
}

const ERROR_TEXT: Record<string, string> = {
  microphone_denied: 'The microphone is blocked. Allow it in the browser and try again.',
  at_capacity: 'Bolna is busy right now (call limit reached). Try again in a minute.',
  connect_failed: 'Could not connect. Check the internet connection and try again.',
  autoplay_blocked: 'The browser blocked the sound. Tap the button again.',
  call_rejected: 'Bolna declined the call. The agent may not be set up yet.',
};

// The SDK (with its SIP stack) is a separate chunk, loaded when a page that makes calls opens,
// so it's ready by the time someone presses the button.
type Sdk = typeof import('@bolna/web-call');
let sdk: Sdk | null = null;
const loadSdk = (): Promise<Sdk> =>
  import('@bolna/web-call').then((m) => {
    sdk = m;
    return m;
  });

export function useWebCall() {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const [minted, setMinted] = useState<Omit<Minted, 'session'> | null>(null);
  const callRef = useRef<BolnaWebCall | null>(null);
  // Our server's own reason when it can't start the call (e.g. "the Desk agent is not set up"),
  // which is clearer than the SDK's generic "mint failed".
  const serverReason = useRef<string | null>(null);

  useEffect(() => {
    void loadSdk();
    return () => {
      void callRef.current?.stop();
    };
  }, []);

  // Runs straight from a click, so the browser lets the agent's audio play.
  const start = useCallback((request: SessionRequest) => {
    setError(null);
    setMinted(null);
    serverReason.current = null;
    const begin = (m: Sdk) => {
      const call = new m.BolnaWebCall({
        getSession: async () => {
          try {
            const result = await api<Minted>('/api/web-session', { json: request });
            setMinted({ requestId: result.requestId, callId: result.callId });
            return result.session;
          } catch (e) {
            serverReason.current = e instanceof Error ? e.message : String(e);
            throw e;
          }
        },
      });
      call.on('state-change', setState);
      call.on('volume-level', setVolume);
      call.on('error', (e) =>
        setError(
          (e.code === 'mint_failed' && serverReason.current) || ERROR_TEXT[e.code] || e.message,
        ),
      );
      callRef.current = call;
      call.start().catch((e: unknown) => {
        setError(
          (current) =>
            current ??
            serverReason.current ??
            (e instanceof Error ? e.message : 'The call could not start.'),
        );
        setState('idle');
      });
    };
    if (sdk) begin(sdk);
    else {
      setState('connecting');
      loadSdk()
        .then(begin)
        .catch(() => {
          setError('Could not load the calling component. Check the connection and try again.');
          setState('idle');
        });
    }
  }, []);

  const stop = useCallback(() => {
    void callRef.current?.stop();
  }, []);

  return {
    state,
    error,
    volume,
    minted,
    start,
    stop,
    active: state === 'connecting' || state === 'ringing' || state === 'active',
  };
}
