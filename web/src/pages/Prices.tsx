// Price memory: each item's best price per order over time, so a buyer can tell whether today's
// bhaav is good. Fewer than 4 orders show as figures instead of a chart (a line needs points).

import type { PriceSeries } from '@bhaav/shared';
import { usePrices } from '../api';
import { PriceChart, trendSentence } from '../chart';
import { rupees, unitWord } from '../format';
import { ChartLineUp } from '../icons';
import { ButtonLink, Card, EmptyState, Notice, PageTitle, useDocumentTitle } from '../ui';

const day = (ms: number) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(ms),
  );

export function PricesPage() {
  useDocumentTitle('Price memory');
  const prices = usePrices();
  return (
    <>
      <PageTitle
        eyebrow="Price memory"
        title="The best price Bhaav found, order by order"
        sub="For each item, the cheapest delivered quote on every order. These are quotes, not what you paid; practice orders are not counted."
      />
      {prices.isPending && <p className="text-muted-fg">Loading prices…</p>}
      {prices.error && <Notice tone="danger">{prices.error.message}</Notice>}
      {prices.data?.length === 0 && (
        <EmptyState icon={ChartLineUp} title="No prices yet">
          <p>Finish an order and its best price appears here.</p>
          <ButtonLink to="/" variant="cta" className="mt-3">
            Start an order
          </ButtonLink>
        </EmptyState>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {prices.data?.map((s) => (
          <ItemCard key={`${s.item}|${s.unit}`} series={s} />
        ))}
      </div>
    </>
  );
}

function ItemCard({ series }: { series: PriceSeries }) {
  const unit = unitWord(series.unit);
  const last = series.points.at(-1);
  const lowest = Math.min(...series.points.map((p) => p.perUnit));
  const sentence = trendSentence(series.points, unit);
  return (
    <Card
      title={<span className="capitalize">{series.item}</span>}
      aside={<span className="tabular text-sm text-muted-fg">{series.quotes} quotes</span>}
    >
      {series.points.length >= 4 ? (
        <PriceChart points={series.points} unit={unit} label={sentence} />
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-bg p-4">
            <dt className="text-sm text-muted-fg">Latest best</dt>
            <dd className="tabular mt-1 font-display text-[28px] font-bold leading-tight tracking-tight">
              {rupees(last?.perUnit)} / {unit}
            </dd>
          </div>
          <div className="rounded-2xl bg-bg p-4">
            <dt className="text-sm text-muted-fg">Lowest seen</dt>
            <dd className="tabular mt-1 font-display text-[28px] font-bold leading-tight tracking-tight">
              {rupees(lowest)} / {unit}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-3 text-sm text-muted-fg">{sentence}</p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">
          Show every order
        </summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">Best price per order for {series.item}</caption>
          <thead className="text-muted-fg">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium">
                Date
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Best per {unit}
              </th>
              <th scope="col" className="py-2 font-medium">
                Supplier
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...series.points].reverse().map((p) => (
              <tr key={p.requestId}>
                <td className="tabular py-2 pr-3">{day(p.date)}</td>
                <td className="tabular py-2 pr-3 font-semibold">{rupees(p.perUnit)}</td>
                <td className="py-2">{p.supplierName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}
