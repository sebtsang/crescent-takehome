import type { ReactNode } from 'react';

/**
 * Shared primitives, styled from the Polarity guide: rounded-sm, 1px borders,
 * no shadows, uppercase eyebrow labels, sharp-cornered controls.
 *
 * Every data-bearing primitive has a matching skeleton of the SAME height. The
 * brief grades "does the UI stay still" -- Convex's useQuery returns undefined
 * on first render, so `{data && <Thing/>}` collapses the card to zero height and
 * then snaps it open. Reserving the space up front is the whole trick.
 */

export function Card({
  title,
  meta,
  actions,
  children,
  className = '',
}: {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card flex flex-col ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            {title && <h2 className="eyebrow truncate">{title}</h2>}
            {meta && <span className="truncate text-[0.6875rem] text-txt3">{meta}</span>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Grey block used for every loading state. Never animated -- the guide bans motion flourish. */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`rounded-sm bg-line/70 ${className}`} style={style} aria-hidden />;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex divide-x divide-line border border-line"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={[
              'min-h-7 cursor-pointer px-2 py-1 text-[0.625rem] font-semibold uppercase leading-none tracking-[0.08em] transition-colors',
              active
                ? 'bg-[var(--txt)] text-[var(--bg)]'
                : 'text-txt3 hover:text-txt',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A figure that is always rendered at the same size whether or not the value
 * has arrived, so the KPI row never reflows.
 */
export function Figure({
  value,
  loading,
  size = 'lg',
}: {
  value: string | null;
  loading: boolean;
  size?: 'lg' | 'sm';
}) {
  const cls =
    size === 'lg'
      ? 'text-[1.75rem] leading-[1.15] tracking-tighter'
      : 'text-base leading-[1.15] tracking-tightest';
  if (loading) {
    return <Skeleton className={size === 'lg' ? 'h-[2.0125rem] w-32' : 'h-[1.15rem] w-20'} />;
  }
  return <div className={`num font-medium ${cls}`}>{value ?? '—'}</div>;
}

/** Empty state. Explains WHY it is empty -- a bare "no data" reads as a bug. */
export function EmptyState({ headline, detail }: { headline: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <p className="text-sm text-txt2">{headline}</p>
      {detail && <p className="max-w-sm text-xs leading-snug text-txt3">{detail}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: 'draft' | 'active' | 'ended' }) {
  const tone =
    status === 'active'
      ? 'text-[var(--accent)] border-[var(--accent)]'
      : status === 'ended'
        ? 'text-txt3 border-line'
        : 'text-warn border-warn';
  return (
    <span
      className={`shrink-0 border px-1 py-px text-[0.5625rem] font-semibold uppercase leading-tight tracking-[0.08em] ${tone}`}
    >
      {status}
    </span>
  );
}
