import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useRouteError } from 'react-router';
import { ApiError, api, useAuth, useHealth } from './api';
import type { Icon } from './icons';
import { ArrowClockwise, ChartLineUp, Flask, House, LockKey, Storefront } from './icons';
import {
  Button,
  Field,
  fieldProps,
  inputClass,
  MoreLink,
  Pill,
  Spinner,
  useDocumentTitle,
} from './ui';

const NAV: Array<{ to: string; label: string; short: string; icon: Icon }> = [
  { to: '/', label: 'New order', short: 'Order', icon: House },
  { to: '/prices', label: 'Price memory', short: 'Prices', icon: ChartLineUp },
  { to: '/play', label: 'Be the supplier', short: 'Practice', icon: Storefront },
  { to: '/bench', label: 'Test bench', short: 'Bench', icon: Flask },
];

function ServerStatus() {
  const health = useHealth();
  if (health.data?.ok)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-fg">
        <span className="size-2 rounded-full bg-success motion-safe:animate-pulse" aria-hidden />
        Online
      </span>
    );
  return <Pill tone="warn">{health.isPending ? 'Connecting…' : 'Server offline'}</Pill>;
}

/** The ₹ mark: a dark rounded tile, like an app icon. */
function Mark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-primary font-display font-semibold text-on-primary ${
        size === 'lg' ? 'size-14 rounded-[16px] text-[28px]' : 'size-7 rounded-[8px] text-[15px]'
      }`}
      aria-hidden
    >
      ₹
    </span>
  );
}

function Gate() {
  useDocumentTitle('Enter the passcode');
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
    <div className="mx-auto mt-6 flex max-w-sm flex-col items-center text-center sm:mt-16">
      <Mark size="lg" />
      <h1 className="mt-5 text-[34px] font-bold leading-tight">Enter the passcode</h1>
      <p className="mt-2 text-[17px] text-muted-fg">
        Bhaav makes real phone calls, so it is behind a passcode. Judges: it is in the submission.
      </p>
      <form
        onSubmit={submit}
        className="surface mt-8 flex w-full flex-col gap-4 p-6 text-left"
        noValidate
      >
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
        <Button type="submit" variant="primary" size="lg" busy={busy} icon={LockKey}>
          Open Bhaav
        </Button>
      </form>
    </div>
  );
}

export function Layout() {
  const auth = useAuth();
  const location = useLocation();
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="glass sticky top-0 z-20 border-b border-border/70">
        <div className="mx-auto flex h-13 max-w-5xl items-center gap-6 px-5">
          <NavLink to="/" className="flex min-h-11 items-center gap-2.5" aria-label="Bhaav home">
            <Mark />
            <span className="text-[17px] font-semibold">
              Bhaav <span className="font-normal text-muted-fg">भाव</span>
            </span>
          </NavLink>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center rounded-full px-3.5 text-[13px] tracking-normal transition-colors duration-200 ${
                    isActive ? 'bg-muted font-semibold text-fg' : 'text-fg/80 hover:text-fg'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto md:ml-2">
            <ServerStatus />
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 pb-32 pt-8 sm:pt-12 md:pb-20">
        {auth.isPending ? (
          <p className="flex items-center gap-2 text-muted-fg" role="status">
            <Spinner />
            Loading…
          </p>
        ) : auth.data?.authenticated ? (
          <Suspense fallback={<PageLoading />}>
            <div key={location.pathname} className="page-enter">
              <Outlet />
            </div>
          </Suspense>
        ) : (
          <Gate />
        )}
      </main>

      {/* Phones: the four places live in a frosted tab bar, within thumb reach. */}
      <nav
        aria-label="Main"
        className="glass fixed inset-x-0 bottom-0 z-20 border-t border-border/70 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium tracking-normal ${isActive ? 'text-link' : 'text-muted-fg'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={24} weight={isActive ? 'fill' : 'regular'} aria-hidden />
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

/** A full-page message: big title, one line, then what to do. */
function Message({
  title,
  children,
  actions,
  role,
}: {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  role?: 'alert';
}) {
  return (
    <div
      className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 text-center sm:mt-20"
      role={role}
    >
      <h1 className="text-[34px] font-bold leading-tight sm:text-[40px]">{title}</h1>
      <p className="text-[19px] text-muted-fg">{children}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {actions}
        <MoreLink to="/">Go to the home page</MoreLink>
      </div>
    </div>
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
    <Message
      role="alert"
      title={stale ? 'Bhaav was updated' : 'This page hit a problem'}
      actions={
        <Button variant="primary" icon={ArrowClockwise} onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      }
    >
      {stale
        ? 'Reload to get the new version. Your orders are saved.'
        : 'Reload to try again. Your orders are saved.'}
    </Message>
  );
}

export function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <Message title="This page does not exist">
      The link may be old. Start from the home page.
    </Message>
  );
}

/** An order page that can't show its order: gone (a wrong link) or not loaded (try again). */
export function OrderUnavailable({ error, retry }: { error: Error | null; retry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404;
  useDocumentTitle(missing ? 'Order not found' : 'Order not loaded');
  return (
    <Message
      title={missing ? 'This order does not exist' : 'The order did not load'}
      actions={
        missing ? undefined : (
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
        )
      }
    >
      {missing
        ? 'The link may be mistyped, or from another copy of Bhaav. Start a new order from the home page.'
        : (error?.message ?? 'Check the connection and try again.')}
    </Message>
  );
}
