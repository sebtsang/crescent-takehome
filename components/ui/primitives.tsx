import type { ReactNode } from 'react';

/**
 * Shared primitives, styled after Crescent's product UI: near-white surfaces,
 * hairline borders, no shadows, small sentence-case labels, and purple reserved
 * for primary actions and active state.
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
        <header className="flex items-center justify-between gap-4 px-5 pb-3 pt-4">
          <div className="flex min-w-0 items-baseline gap-3">
            {title && <h2 className="section-title truncate">{title}</h2>}
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
  return <div className={`rounded bg-surface ${className}`} style={style} aria-hidden />;
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
      className="flex gap-0.5 rounded-[0.375rem] bg-surface p-0.5"
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
              'min-h-6 cursor-pointer rounded-[0.25rem] px-2.5 py-1 text-[0.6875rem] font-normal leading-none transition-colors',
              active
                ? 'bg-[var(--surface-raised)] text-txt shadow-soft'
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
      ? 'display text-[1.75rem] leading-[1.15]'
      : 'num text-base font-medium leading-[1.15] tracking-tighter';
  if (loading) {
    return <Skeleton className={size === 'lg' ? 'h-[2.0125rem] w-32' : 'h-[1.15rem] w-20'} />;
  }
  if (value === null) return <div className={cls}>—</div>;

  // Crescent writes the cents smaller and lighter than the dollars. Split on the
  // last decimal point so "$66,705.00" renders as "$66,705" + ".00".
  const m = size === 'lg' ? value.match(/^(.*)(\.\d{2})$/) : null;
  return (
    <div className={cls}>
      {m ? (
        <>
          {m[1]}
          <span className="cents">{m[2]}</span>
        </>
      ) : (
        value
      )}
    </div>
  );
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
      ? 'text-accent bg-accent-soft'
      : status === 'ended'
        ? 'text-txt3 bg-surface'
        : 'text-warn bg-surface';
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-px text-[0.5625rem] font-medium uppercase leading-tight tracking-[0.07em] ${tone}`}
    >
      {status}
    </span>
  );
}
