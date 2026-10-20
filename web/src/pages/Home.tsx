import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, lastOrder } from '../api';
import { ChartLineUp, ChatCircleText, Handshake, ShieldCheck, Storefront } from '../icons';
import {
  Button,
  ButtonLink,
  Field,
  fieldProps,
  inputClass,
  MoreLink,
  useDocumentTitle,
} from '../ui';

const PROMISE = [
  {
    icon: ShieldCheck,
    title: 'Never invents a price.',
    text: "Every number is checked against real quotes before Bhaav says it. A number it can't prove is never spoken.",
    wide: true,
  },
  {
    icon: Handshake,
    title: 'Never agrees to a deal.',
    text: 'Bhaav gathers and bargains. Only you choose the supplier.',
  },
  {
    icon: ChatCircleText,
    title: 'Says it is an AI.',
    text: 'Suppliers hear who is calling and for whom, in their own language.',
  },
  {
    icon: ChartLineUp,
    title: 'Remembers every price.',
    text: "Each order's best price is kept, so you know whether today's bhaav is a good one.",
    wide: true,
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
  useDocumentTitle('');
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
    <div className="flex flex-col gap-16 sm:gap-24">
      <section className="flex flex-col items-center pt-2 text-center sm:pt-8">
        <p className="text-[17px] font-semibold text-muted-fg sm:text-[19px]">
          For restaurants, kirana shops and caterers
        </p>
        <h1 className="mt-2 text-[40px] font-bold leading-[1.05] tracking-[-0.035em] sm:text-[72px]">
          <span className="block">Today's bhaav.</span>{' '}
          <span className="block">From every supplier.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-[19px] leading-snug text-muted-fg sm:text-[24px]">
          Bhaav phones your suppliers in Hindi, Kannada or English, gets real prices, and bargains
          only with offers it truly has.
        </p>

        <form
          onSubmit={create}
          className="surface mt-10 flex w-full max-w-md flex-col gap-4 p-6 text-left"
          noValidate
        >
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
          <Button type="submit" variant="cta" size="lg" busy={busy}>
            Start an order
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8">
          {previous && <MoreLink to={`/r/${previous}`}>Go back to your last order</MoreLink>}
          <MoreLink to="/play">Be the supplier</MoreLink>
        </div>
      </section>

      <section aria-labelledby="promise">
        <h2 id="promise" className="mb-6 text-[32px] font-bold leading-tight sm:text-[40px]">
          The Bhaav promise.
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PROMISE.map((p) => (
            <li key={p.title} className={`surface p-6 sm:p-7 ${p.wide ? 'sm:col-span-2' : ''}`}>
              <span className="grid size-10 place-items-center rounded-xl bg-muted" aria-hidden>
                <p.icon size={22} className="text-fg" />
              </span>
              <p className="mt-5 text-[21px] font-semibold leading-tight">{p.title}</p>
              <p className="mt-2 text-[17px] text-muted-fg">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="how"
        className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      >
        <div className="surface p-6 sm:p-8">
          <h2 id="how" className="mb-6 text-[32px] font-bold leading-tight sm:text-[40px]">
            How it works.
          </h2>
          <ol className="flex flex-col">
            {STEPS.map((step, i) => (
              <li
                key={step}
                className="flex items-start gap-4 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0"
              >
                <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[15px] font-semibold">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-[17px]">{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="surface flex flex-col p-6 sm:p-8">
          <span className="grid size-10 place-items-center rounded-xl bg-muted" aria-hidden>
            <Storefront size={22} />
          </span>
          <h2 className="mt-5 text-[24px] font-bold leading-tight">Judging Bhaav?</h2>
          <p className="mt-2 text-[17px] text-muted-fg">
            Take Bhaav's call as a supplier and try to make it say a price it can't prove. The
            lie-catcher shows what it stopped.
          </p>
          <ButtonLink to="/play" variant="secondary" className="mt-6 self-start">
            Be the supplier
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
