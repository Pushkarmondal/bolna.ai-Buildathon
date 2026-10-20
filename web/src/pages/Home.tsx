import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, lastOrder } from '../api';
import { Button, Card, Field, inputClass, Notice, PageTitle } from '../ui';

export function HomePage() {
  const navigate = useNavigate();
  const [buyerName, setBuyerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previous = lastOrder.get();

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!buyerName.trim()) {
      setError('Type the business name, so suppliers know who Bhaav is calling for.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>('/api/requests', { json: { buyerName } });
      lastOrder.set(id);
      navigate(`/r/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the order.');
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Get today's bhaav without the phone calls"
        sub="Tell Bhaav what you need. It calls your suppliers, gets real prices, and bargains only with offers it truly has."
      />
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <Card title="Start a new order">
          <form onSubmit={create} className="flex flex-col gap-3">
            <Field
              label="Your business name"
              hint="Bhaav says this name to every supplier it calls."
            >
              <input
                className={inputClass}
                placeholder="Meena's Kitchen"
                value={buyerName}
                maxLength={80}
                onChange={(e) => setBuyerName(e.target.value)}
              />
            </Field>
            {error && <Notice tone="bad">{error}</Notice>}
            <Button type="submit" busy={busy}>
              Start an order
            </Button>
          </form>
          {previous && (
            <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">
              Or{' '}
              <Link className="underline underline-offset-4" to={`/r/${previous}`}>
                go back to your last order
              </Link>
              .
            </p>
          )}
        </Card>
        <Card title="How it works">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-stone-700 dark:text-stone-300">
            <li>Tell Bhaav what you need, by voice or by typing.</li>
            <li>Add the suppliers you already buy from.</li>
            <li>Bhaav calls each one, one at a time, and reads every price back.</li>
            <li>It calls the costlier ones back with the best real offer.</li>
            <li>You pick the winner. Bhaav never agrees to a deal on its own.</li>
          </ol>
          <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
            Judges: try{' '}
            <Link className="underline underline-offset-4" to="/play">
              Be the supplier
            </Link>{' '}
            and try to make Bhaav say a price it can't prove.
          </p>
        </Card>
      </div>
    </>
  );
}
