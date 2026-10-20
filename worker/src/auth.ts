// Three kinds of caller, three checks: people with the passcode (a signed cookie), Bolna's LLM
// and tool calls (a Bearer secret), and Bolna's webhook (a secret in the path).

import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

const COOKIE = 'bhaav_session';
const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

export function bearerMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  return safeEqual(header.slice('Bearer '.length), secret);
}

/** Middleware: Bolna's own calls must carry the given secret as a Bearer token. */
export function requireBearer(secret: (env: Cloudflare.Env) => string): MiddlewareHandler<{
  Bindings: Cloudflare.Env;
}> {
  return async (c, next) => {
    if (!bearerMatches(c.req.header('authorization'), secret(c.env))) {
      return c.json({ error: { message: 'unauthorized' } }, 401);
    }
    await next();
  };
}

type AppContext = Context<{ Bindings: Cloudflare.Env }>;

export async function hasSession(c: AppContext): Promise<boolean> {
  if (!c.env.COOKIE_SECRET) return false;
  const value = await getSignedCookie(c, c.env.COOKIE_SECRET, COOKIE);
  return value === 'ok';
}

export async function startSession(c: AppContext): Promise<void> {
  await setSignedCookie(c, COOKIE, 'ok', c.env.COOKIE_SECRET, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: WEEK_SECONDS,
  });
}

export function endSession(c: AppContext): void {
  deleteCookie(c, COOKIE, { path: '/', secure: true });
}

/** Middleware: the screens' API needs the passcode session. */
export const requireSession: MiddlewareHandler<{ Bindings: Cloudflare.Env }> = async (c, next) => {
  if (!(await hasSession(c))) return c.json({ error: 'Enter the passcode first.' }, 401);
  await next();
};
