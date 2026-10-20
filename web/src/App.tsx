import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, Suspense, useState } from 'react';
import { NavLink, Outlet, useRouteError } from 'react-router';
import { api, useAuth, useHealth } from './api';
import type { Icon } from './icons';
import { ArrowClockwise, ChartLineUp, Flask, House, LockKey, Storefront } from './icons';
import { Button, Card, Field, fieldProps, inputClass, Pill, Spinner } from './ui';

const NAV: Array<{ to: string; label: string; short: string; icon: Icon }> = [
  { to: '/', label: 'New order', short: 'Order', icon: House },
  { to: '/prices', label: 'Price memory', short: 'Prices', icon: ChartLineUp },
  { to: '/play', label: 'Be the supplier', short: 'Practice', icon: Storefront },
  { to: '/bench', label: 'Test bench', short: 'Bench', icon: Flask },
];

function ServerStatus() {
  const health = useHealth();
  if (health.data?.ok) return <Pill tone="success">Online</Pill>;
  return <Pill tone="warn">{health.isPending ? 'Connecting…' : 'Server offline'}</Pill>;
}

function Gate() {
  const queryClient = useQueryClient();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) {
      setError('Type the passcode to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth', { json: { passcode } });
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the passcode. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-sm sm:mt-16">
      <Card title="Enter the passcode" icon={LockKey}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-muted-fg">
            Bhaav makes real phone calls, so it is behind a passcode. Judges: it is in the
            submission.
          </p>
          <Field id="passcode" label="Passcode" error={error}>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              {...fieldProps('passcode', { error })}
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" busy={busy}>
            Open Bhaav
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function Layout() {
  const auth = useAuth();
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <NavLink to="/" className="flex min-h-11 items-center gap-2" aria-label="Bhaav home">
            <span
              className="grid size-8 place-items-center rounded-lg bg-primary font-display text-base font-bold text-on-primary"
              aria-hidden
            >
              ₹
            </span>
            <span className="font-display text-lg font-semibold">
              Bhaav <span className="font-normal text-muted-fg">भाव</span>
            </span>
          </NavLink>
          <nav aria-label="Main" className="hidden gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                    isActive ? 'bg-muted text-fg' : 'text-muted-fg hover:bg-muted hover:text-fg'
                  }`
                }
              >
                <item.icon size={18} aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto">
            <ServerStatus />
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:pt-8 md:pb-12">
        {auth.isPending ? (
          <p className="text-muted-fg">Loading…</p>
        ) : auth.data?.authenticated ? (
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        ) : (
          <Gate />
        )}
      </main>

      {/* Phones: the four places live in a bottom bar, within thumb reach. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-primary' : 'text-muted-fg'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={22} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                    {item.short}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function PageLoading() {
  return (
    <p className="flex items-center gap-2 text-muted-fg" role="status">
      <Spinner />
      Opening the page…
    </p>
  );
}

/** After a deploy, an open tab asks for page files that no longer exist; a reload fetches the new ones. */
const STALE_BUILD =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i;

export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error ?? '');
  const stale = STALE_BUILD.test(message);
  return (
    <div
      className="mx-auto mt-8 flex max-w-md flex-col items-center gap-3 text-center"
      role="alert"
    >
      <h1 className="text-2xl font-semibold">
        {stale ? 'Bhaav was updated' : 'This page hit a problem'}
      </h1>
      <p className="text-muted-fg">
        {stale
          ? 'Reload to get the new version. Your orders are saved.'
          : 'Reload to try again. Your orders are saved.'}
      </p>
      <Button variant="primary" icon={ArrowClockwise} onClick={() => window.location.reload()}>
        Reload the page
      </Button>
      <NavLink
        to="/"
        className="inline-flex min-h-11 items-center font-medium text-link underline-offset-4 hover:underline"
      >
        Go to the home page
      </NavLink>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="mx-auto mt-8 max-w-md text-center">
      <h1 className="text-2xl font-semibold">This page does not exist</h1>
      <p className="mt-2 text-muted-fg">The link may be old. Start from the home page.</p>
      <NavLink
        to="/"
        className="mt-4 inline-flex min-h-11 items-center font-medium text-link underline-offset-4 hover:underline"
      >
        Go to the home page
      </NavLink>
    </div>
  );
}
