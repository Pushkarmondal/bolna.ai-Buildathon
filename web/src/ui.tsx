// Shared building blocks, in an Apple-style system: white cards on a grey page, pill buttons, one
// blue for actions. Every control is at least 44px tall, every status carries words as well as
// colour, and every input has a visible label with its hint or error linked by aria-describedby.

import { type ButtonHTMLAttributes, type ReactNode, useEffect } from 'react';
import { Link, type LinkProps } from 'react-router';
import { CheckCircle, type Icon, Info, WarningCircle, XCircle } from './icons';

export function Card({
  title,
  aside,
  children,
  className = '',
  icon: IconComponent,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: Icon;
}) {
  return (
    <section className={`surface min-w-0 p-5 sm:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {title && (
            <h2 className="flex items-center gap-2.5 text-[21px] font-semibold leading-tight text-fg">
              {IconComponent && (
                <IconComponent size={22} className="shrink-0 text-muted-fg" aria-hidden />
              )}
              {title}
            </h2>
          )}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';

const PILL: Record<Tone, string> = {
  neutral: 'bg-muted text-fg',
  success: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

export function Pill({
  tone = 'neutral',
  children,
  pulse,
  icon: IconComponent,
}: {
  tone?: Tone;
  children: ReactNode;
  pulse?: boolean;
  icon?: Icon;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tracking-normal ${PILL[tone]}`}
    >
      {pulse && (
        <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />
      )}
      {IconComponent && <IconComponent size={14} weight="bold" aria-hidden />}
      {children}
    </span>
  );
}

type Variant = 'cta' | 'primary' | 'secondary' | 'ghost' | 'ghost-danger' | 'danger';

// Apple's buttons: a filled blue pill for the action, a quiet outlined pill beside it.
const BUTTON: Record<Variant, string> = {
  cta: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'border border-border bg-card text-link hover:bg-muted',
  ghost: 'text-link hover:bg-muted',
  // A row's destructive action (Remove): red text, as Apple marks destructive actions.
  'ghost-danger': 'text-danger hover:bg-danger-soft',
  danger: 'bg-danger-soft text-danger hover:brightness-95',
};

const buttonClass = (variant: Variant, size: 'md' | 'lg', extra = '') =>
  `inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-medium tracking-normal transition-[filter,background-color,transform] duration-200 ease-apple active:scale-[0.98] ${
    size === 'lg' ? 'min-h-12 px-7 text-[17px]' : 'min-h-11 px-5 text-[15px]'
  } ${BUTTON[variant]} ${extra}`;

export function Spinner() {
  return (
    <span
      className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
      aria-hidden
    />
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'md' | 'lg';
  busy?: boolean;
  icon?: Icon;
};

/** While busy the button says so and ignores presses; it is never greyed out with a hidden reason. */
export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  icon: IconComponent,
  className = '',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      aria-busy={busy || undefined}
      className={`${buttonClass(variant, size, className)} ${busy ? 'cursor-wait opacity-80' : ''}`}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {busy ? <Spinner /> : IconComponent && <IconComponent size={18} aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon: IconComponent,
  className = '',
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: 'md' | 'lg'; icon?: Icon }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {IconComponent && <IconComponent size={18} aria-hidden />}
      {children}
    </Link>
  );
}

/** A text link in Apple's style: blue, with a trailing chevron that nudges on hover. */
export function MoreLink({ children, ...rest }: LinkProps) {
  return (
    <Link
      className="group inline-flex min-h-11 items-center gap-1 text-[17px] text-link hover:underline"
      {...rest}
    >
      {children}
      <span
        className="transition-transform duration-200 ease-apple group-hover:translate-x-0.5"
        aria-hidden
      >
        ›
      </span>
    </Link>
  );
}

export const inputClass =
  'block min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3.5 py-2 text-[17px] text-fg placeholder:text-muted-fg transition-shadow duration-200 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/20 aria-[invalid=true]:border-danger';

/** Props that link an input to its label, hint and error. */
export function fieldProps(
  id: string,
  { hint, error }: { hint?: ReactNode; error?: ReactNode | null },
) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return {
    id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : undefined,
  };
}

export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode | null;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
        {required && <span className="font-normal text-muted-fg"> (required)</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-fg">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm text-danger" role="alert">
          <WarningCircle size={18} weight="bold" className="mt-px shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

const NOTICE: Record<Exclude<Tone, 'neutral'>, { box: string; icon: Icon }> = {
  info: { box: 'bg-info-soft text-info', icon: Info },
  warn: { box: 'bg-warn-soft text-warn', icon: WarningCircle },
  danger: { box: 'bg-danger-soft text-danger', icon: XCircle },
  success: { box: 'bg-success-soft text-success', icon: CheckCircle },
};

/** A message in a tinted box. Errors are announced (role="alert"); others are polite status. */
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: Exclude<Tone, 'neutral'>;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const { box, icon: IconComponent } = NOTICE[tone];
  return (
    <div
      className={`flex gap-3 rounded-2xl px-4 py-3.5 text-[15px] ${box}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <IconComponent size={20} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** How loudly Bhaav is speaking, so people can see the call is live. */
export function VoiceMeter({
  level,
  label = "Bhaav's voice level",
}: {
  level: number;
  label?: string;
}) {
  const pct = Math.round(Math.min(1, level * 2.5) * 100);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled level bar; a native <meter> can't be styled the same in every browser
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className="h-full origin-left rounded-full bg-accent transition-transform duration-100"
        style={{ transform: `scaleX(${pct / 100})` }}
      />
    </div>
  );
}

/** The page's headline: a quiet eyebrow, a big tight title, and one line of context. */
export function PageTitle({
  eyebrow,
  title,
  sub,
  aside,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 sm:mb-10">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className="mb-1.5 text-[17px] font-semibold text-muted-fg">{eyebrow}</p>}
        <h1 className="text-[34px] font-bold leading-[1.08] text-fg sm:text-[48px]">{title}</h1>
        {sub && <p className="mt-3 text-[19px] leading-snug text-muted-fg sm:text-[21px]">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'success';
}) {
  return (
    <div className="surface min-w-0 p-5 sm:p-6">
      <p className="text-sm text-muted-fg">{label}</p>
      <p
        className={`tabular mt-1 font-display text-[34px] font-bold leading-tight tracking-tight sm:text-[40px] ${tone === 'success' ? 'text-success' : 'text-fg'}`}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-sm text-muted-fg">{note}</p>}
    </div>
  );
}

export function EmptyState({
  icon: IconComponent,
  title,
  children,
}: {
  icon: Icon;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-muted/60 px-4 py-10 text-center">
      <IconComponent size={32} weight="light" className="text-muted-fg" aria-hidden />
      <p className="text-[17px] font-semibold text-fg">{title}</p>
      {children && <div className="max-w-sm text-[15px] text-muted-fg">{children}</div>}
    </div>
  );
}

/** Where the buyer is in the draft order: what's done, what's next. */
export function Steps({ steps }: { steps: Array<{ label: string; done: boolean }> }) {
  return (
    <ol className="-mt-4 mb-8 flex flex-wrap gap-2" aria-label="Order progress">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium tracking-normal ${s.done ? 'bg-success-soft text-success' : 'bg-muted text-fg'}`}
        >
          {s.done ? (
            <CheckCircle size={16} weight="fill" aria-hidden />
          ) : (
            <span className="tabular grid size-4 place-items-center text-xs font-semibold">
              {i + 1}
            </span>
          )}
          <span>
            {s.label}
            <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Names the browser tab and history entry after the page: "Price memory · Bhaav". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Bhaav` : 'Bhaav — honest supplier calls';
  }, [title]);
}
