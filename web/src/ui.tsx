// Shared building blocks. Every control is at least 44px tall, every status carries words as well
// as colour, and every input has a visible label with its hint or error linked by aria-describedby.

import type { ButtonHTMLAttributes, ReactNode } from 'react';
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
    <section className={`rounded-2xl border border-border bg-card p-4 sm:p-5 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
              {IconComponent && (
                <IconComponent size={20} weight="duotone" className="text-primary" aria-hidden />
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
  neutral: 'bg-muted text-muted-fg',
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${PILL[tone]}`}
    >
      {pulse && (
        <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />
      )}
      {IconComponent && <IconComponent size={14} weight="bold" aria-hidden />}
      {children}
    </span>
  );
}

type Variant = 'cta' | 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON: Record<Variant, string> = {
  cta: 'bg-accent text-on-accent hover:brightness-110',
  primary: 'bg-primary text-on-primary hover:brightness-110',
  secondary: 'border border-input bg-card text-fg hover:bg-muted',
  ghost: 'text-fg hover:bg-muted',
  danger: 'bg-danger-soft text-danger border border-danger/40 hover:brightness-95',
};

const buttonClass = (variant: Variant, size: 'md' | 'lg', extra = '') =>
  `inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-medium transition-[filter,background-color] duration-200 ${
    size === 'lg' ? 'min-h-12 px-5 text-base' : 'min-h-11 px-4 text-sm'
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
      {busy ? <Spinner /> : IconComponent && <IconComponent size={18} weight="bold" aria-hidden />}
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
      {IconComponent && <IconComponent size={18} weight="bold" aria-hidden />}
      {children}
    </Link>
  );
}

export const inputClass =
  'block min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3 py-2 text-base text-fg placeholder:text-muted-fg aria-[invalid=true]:border-danger';

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
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required && <span className="text-muted-fg"> (required)</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-fg">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm text-danger" role="alert">
          <WarningCircle size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

const NOTICE: Record<Exclude<Tone, 'neutral'>, { box: string; icon: Icon }> = {
  info: { box: 'border-info/30 bg-info-soft text-info', icon: Info },
  warn: { box: 'border-warn/30 bg-warn-soft text-warn', icon: WarningCircle },
  danger: { box: 'border-danger/30 bg-danger-soft text-danger', icon: XCircle },
  success: { box: 'border-success/30 bg-success-soft text-success', icon: CheckCircle },
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
      className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${box}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <IconComponent size={20} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
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
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <p className="mb-1 text-sm font-medium text-primary">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{title}</h1>
        {sub && <p className="mt-2 text-base text-muted-fg">{sub}</p>}
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
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted-fg">{label}</p>
      <p
        className={`tabular mt-1 font-display text-2xl font-semibold ${tone === 'success' ? 'text-success' : 'text-fg'}`}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-sm text-muted-fg">{note}</p>}
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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <IconComponent size={28} weight="duotone" className="text-muted-fg" aria-hidden />
      <p className="font-medium text-fg">{title}</p>
      {children && <div className="text-sm text-muted-fg">{children}</div>}
    </div>
  );
}

/** Where the buyer is in the draft order: what's done, what's next. */
export function Steps({ steps }: { steps: Array<{ label: string; done: boolean }> }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label="Order progress">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${s.done ? 'bg-success-soft text-success' : 'bg-muted text-muted-fg'}`}
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
