import type { OrderView, Persona, PriceSeries } from '@bhaav/shared';
import { useQuery } from '@tanstack/react-query';
import { isLive } from './format';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** Calls the Worker; a non-2xx answer throws its `error` message, ready to show on screen. */
export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
    headers: init.json === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    credentials: 'same-origin',
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Something went wrong (${res.status}).`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ ok: boolean }>('/api/health'),
    refetchInterval: 10_000,
  });
}

export function useAuth() {
  return useQuery({
    queryKey: ['auth'],
    queryFn: () => api<{ authenticated: boolean }>('/api/auth'),
  });
}

/** One order, polled every 2 seconds while anything can still change. */
export function useOrder(id: string) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderView>(`/api/requests/${id}`),
    refetchInterval: (query) => {
      const view = query.state.data;
      // An approved order only changes again while Bhaav is on the confirmation call.
      if (view?.order.status === 'approved' && !view.calls.some((c) => isLive(c.status)))
        return false;
      return 2000;
    },
  });
}

export function usePrices() {
  return useQuery({
    queryKey: ['prices'],
    queryFn: () => api<PriceSeries[]>('/api/prices'),
  });
}

export function usePersonas() {
  return useQuery({
    queryKey: ['personas'],
    queryFn: () => api<Persona[]>('/api/practice/personas'),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export interface PracticeReview {
  callId: string;
  status: string;
  bestOffer: string | null;
  transcript: string | null;
  blocked: Array<{ type: string; detail: Record<string, unknown> | null; createdAt: number }>;
  quotes: Array<{ price: number; unit: string; packSize: number | null; supplierWords: string }>;
}

/** The last order this browser opened, so a refresh doesn't lose it. Storage can be unavailable. */
export const lastOrder = {
  get(): string | null {
    try {
      return localStorage.getItem('bhaav:lastOrder');
    } catch {
      return null;
    }
  },
  set(id: string) {
    try {
      localStorage.setItem('bhaav:lastOrder', id);
    } catch {
      // Not remembering is fine.
    }
  },
};
