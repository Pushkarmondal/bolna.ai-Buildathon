import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, lastOrder } from '../api';
import {
  ArrowRight,
  ChatCircleText,
  ClockCounterClockwise,
  Handshake,
  ShieldCheck,
  Storefront,
} from '../icons';
import { Button, ButtonLink, Card, Field, fieldProps, inputClass } from '../ui';

const PROMISE = [
  {
    icon: ShieldCheck,
    title: 'Never invents a price',
    text: 'Every number is checked against real quotes before Bhaav says it.',
  },
  {
    icon: Handshake,
    title: 'Never agrees to a deal',
    text: 'Bhaav gathers and bargains. Only you choose the supplier.',
  },
  {
    icon: ChatCircleText,
    title: 'Says it is an AI',
    text: 'Suppliers hear who is calling and for whom, in their language.',
  },
];

const STEPS = [
  'Tell Bhaav what you need, by voice or by typing.',
  'Add the suppliers you already buy from.',
  'Bhaav calls each one and reads every price back.',
  'It calls the costlier ones back with the best real offer.',
  'You see the ranked quotes, with proof, and choose.',
];

export function HomePage() {
  const navigate = useNavigate();
  const [buyerName, setBuyerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previous = lastOrder.get();

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!buyerName.trim()) {
      setError('Type your business name. Bhaav says it to every supplier it calls.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>('/api/requests', { json: { buyerName } });
      lastOrder.set(id);
      navigate(`/r/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the order. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="pt-2">
          <p className="mb-2 text-sm font-medium text-primary">
            For restaurants, kirana shops and caterers
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Today's bhaav from every supplier, without a single phone call.
          </h1>
          <p className="mt-3 max-w-xl text-lg text-muted-fg">
            Bhaav phones your suppliers in Hindi, Kannada or English, gets real prices, and bargains
            only with offers it truly has.
          </p>
        </div>
        <Card title="Start an order">
          <form onSubmit={create} className="flex flex-col gap-4" noValidate>
            <Field
              id="buyer-name"
              label="Your business name"
              hint="Bhaav says this name to every supplier it calls."
              error={error}
            >
              <input
                className={inputClass}
                placeholder="e.g. Meena's Kitchen"
                autoComplete="organization"
                value={buyerName}
                maxLength={80}
                onChange={(e) => setBuyerName(e.target.value)}
                {...fieldProps('buyer-name', { hint: true, error })}
              />
            </Field>
            <Button type="submit" variant="cta" size="lg" busy={busy} icon={ArrowRight}>
              Start an order
            </Button>
          </form>
          {previous && (
            <Link
              className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-link underline-offset-4 hover:underline"
              to={`/r/${previous}`}
            >
              <ClockCounterClockwise size={18} aria-hidden />
              Go back to your last order
            </Link>
          )}
        </Card>
      </section>

      <section aria-labelledby="promise">
        <h2 id="promise" className="mb-4 text-xl font-semibold">
          The Bhaav promise
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {PROMISE.map((p) => (
            <li key={p.title} className="rounded-2xl border border-border bg-card p-4">
              <p.icon size={26} weight="duotone" className="text-accent" aria-hidden />
              <p className="mt-2 font-semibold">{p.title}</p>
              <p className="mt-1 text-sm text-muted-fg">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="how"
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
      >
        <div>
          <h2 id="how" className="mb-4 text-xl font-semibold">
            How it works
          </h2>
          <ol className="flex flex-col gap-3">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-primary font-display text-sm font-semibold text-on-primary">
                  {i + 1}
                </span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <Card title="Judging Bhaav?" icon={Storefront}>
          <p className="text-muted-fg">
            Take Bhaav's call as a supplier and try to make it say a price it can't prove. The
            lie-catcher shows what it stopped.
          </p>
          <ButtonLink to="/play" variant="secondary" className="mt-4" icon={ArrowRight}>
            Be the supplier
          </ButtonLink>
        </Card>
      </section>
    </div>
  );
}
