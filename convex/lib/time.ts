/**
 * Time and date-range resolution. ALL reporting buckets in UTC.
 *
 * Why UTC: `createdAt` is epoch milliseconds and the seed epoch is UTC midnight,
 * so a seed day index equals a UTC calendar day exactly. That makes every figure
 * reproducible. It is NOT the right production answer -- a nonprofit wants its
 * own local timezone, and 46 of the 251 succeeded gifts land on a different
 * calendar day in America/Toronto. Production would read an org setting here.
 *
 * Ranges are HALF-OPEN: [startMs, endMs). A closed range double-counts any row
 * sitting exactly on a boundary when two adjacent periods are compared.
 *
 * `null` for either bound means unbounded on that side.
 */

export const REPORTING_TIMEZONE = 'UTC';

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_PRESETS = [
  'all_time',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export type RangeSpec =
  | { preset: RangePreset }
  /**
   * Date-only strings ("2026-03-01"). `endISO` is INCLUSIVE of that whole day --
   * a user asking for March expects March 31st included. Converted to an
   * exclusive bound internally.
   */
  | { startISO: string; endISO: string };

export type ResolvedRange = {
  startMs: number | null;
  endMs: number | null;
  startISO: string | null;
  endISO: string | null;
  timezone: string;
  preset?: RangePreset;
};

export const UNBOUNDED_RANGE: ResolvedRange = {
  startMs: null,
  endMs: null,
  startISO: null,
  endISO: null,
  timezone: REPORTING_TIMEZONE,
  preset: 'all_time',
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function addUtcMonths(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

/** Inclusive day bound -> exclusive ms bound, so callers can think in whole days. */
function parseDateOnly(iso: string, label: string): number {
  if (!DATE_ONLY.test(iso)) {
    throw new Error(`${label} must be a YYYY-MM-DD date, got "${iso}"`);
  }
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new Error(`${label} is not a valid date: "${iso}"`);
  return ms;
}

/** Exclusive end bound rendered back as the inclusive day the caller asked for. */
function toInclusiveEndISO(endMsExclusive: number): string {
  return new Date(endMsExclusive - 1).toISOString().slice(0, 10);
}

/**
 * `nowMs` is a parameter, never `Date.now()` inside. A pure function that reads
 * the clock cannot be tested, and "last month" must be reproducible.
 */
export function resolveRange(spec: RangeSpec, nowMs: number): ResolvedRange {
  if ('startISO' in spec) {
    const startMs = parseDateOnly(spec.startISO, 'startISO');
    const endMs = parseDateOnly(spec.endISO, 'endISO') + DAY_MS;
    if (endMs <= startMs) {
      throw new Error(`endISO (${spec.endISO}) must not precede startISO (${spec.startISO})`);
    }
    return {
      startMs,
      endMs,
      startISO: spec.startISO,
      endISO: spec.endISO,
      timezone: REPORTING_TIMEZONE,
    };
  }

  const today = startOfUtcDay(nowMs);
  const tomorrow = today + DAY_MS;

  const bounded = (startMs: number, endMs: number): ResolvedRange => ({
    startMs,
    endMs,
    startISO: new Date(startMs).toISOString().slice(0, 10),
    endISO: toInclusiveEndISO(endMs),
    timezone: REPORTING_TIMEZONE,
    preset: spec.preset,
  });

  switch (spec.preset) {
    case 'all_time':
      return { ...UNBOUNDED_RANGE, preset: 'all_time' };
    // "Last N days" counts whole calendar days ENDING TODAY, today included.
    case 'last_7_days':
      return bounded(today - 6 * DAY_MS, tomorrow);
    case 'last_30_days':
      return bounded(today - 29 * DAY_MS, tomorrow);
    case 'last_90_days':
      return bounded(today - 89 * DAY_MS, tomorrow);
    case 'this_month':
      return bounded(startOfUtcMonth(nowMs), addUtcMonths(nowMs, 1));
    case 'last_month':
      return bounded(addUtcMonths(nowMs, -1), startOfUtcMonth(nowMs));
    case 'this_quarter': {
      const d = new Date(nowMs);
      const quarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
      const start = Date.UTC(d.getUTCFullYear(), quarterStartMonth, 1);
      return bounded(start, Date.UTC(d.getUTCFullYear(), quarterStartMonth + 3, 1));
    }
    case 'this_year': {
      const year = new Date(nowMs).getUTCFullYear();
      return bounded(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1));
    }
    default: {
      const exhaustive: never = spec.preset;
      throw new Error(`Unknown range preset: ${String(exhaustive)}`);
    }
  }
}

/** True when `ms` falls inside the half-open range. */
export function isWithinRange(ms: number, range: ResolvedRange): boolean {
  if (range.startMs !== null && ms < range.startMs) return false;
  if (range.endMs !== null && ms >= range.endMs) return false;
  return true;
}

export type Granularity = 'day' | 'week' | 'month';

/** UTC bucket label: day/week -> "YYYY-MM-DD", month -> "YYYY-MM". Weeks start Monday. */
export function bucketKey(ms: number, granularity: Granularity): string {
  const iso = new Date(ms).toISOString();
  if (granularity === 'month') return iso.slice(0, 7);
  if (granularity === 'day') return iso.slice(0, 10);
  const dayStart = startOfUtcDay(ms);
  const weekday = new Date(dayStart).getUTCDay(); // 0=Sunday
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(dayStart - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}
