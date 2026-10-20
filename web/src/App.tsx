import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { api, useAuth, useHealth } from './api';
import { Button, Card, Field, inputClass, Notice, Pill } from './ui';

const nav = [
  { to: '/', label: 'New order' },
  { to: '/play', label: 'Be the supplier' },
  { to: '/bench', label: 'Test bench' },
];

function ServerStatus() {
  const health = useHealth();
  if (health.data?.ok) return <Pill tone="good">Server connected</Pill>;
  return <Pill tone="warn">{health.isPending ? 'Connecting…' : 'Server not reachable'}</Pill>;
}

function Gate() {
  const queryClient = useQueryClient();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth', { json: { passcode } });
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the passcode.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-sm">
      <Card title="Enter the passcode">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Bhaav makes real phone calls, so it is behind a passcode. Judges: it is in the
            submission.
          </p>
          <Field label="Passcode">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <Button type="submit" busy={busy}>
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
    <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="text-lg font-semibold tracking-tight">
            Bhaav <span className="font-normal text-stone-500">भाव</span>
          </NavLink>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  isActive
                    ? 'font-medium text-stone-900 underline underline-offset-4 dark:text-white'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto">
            <ServerStatus />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        {auth.isPending ? (
          <p className="text-stone-500">Loading…</p>
        ) : auth.data?.authenticated ? (
          <Outlet />
        ) : (
          <Gate />
        )}
      </main>
    </div>
  );
}
