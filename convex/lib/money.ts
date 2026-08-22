/**
 * Money primitives. Every amount in this codebase is INTEGER CENTS.
 *
 * There is exactly one formatter, and it lives here. Both the dashboard and the
 * agent render money by calling it, so a figure can never be formatted two
 * different ways depending on which surface asked for it.
 */

/** Guards against a float sneaking into a money field and infecting every total. */
export function assertIntegerCents(value: number, label = 'amount'): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number of cents, got ${value}`);
  }
}

/**
 * 6670500 -> "$66,705.00". Deliberately avoids dividing by 100: integer
 * division plus a padded remainder cannot introduce a floating-point artifact.
 */
export function formatCents(cents: number): string {
  assertIntegerCents(cents, 'cents');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${String(fraction).padStart(2, '0')}`;
}

/** Sum that refuses to silently accept a non-integer. */
export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertIntegerCents(value, 'cents');
    total += value;
  }
  return total;
}

/**
 * Mean as integer cents, or null for an empty set. Null rather than 0 or NaN:
 * "no gifts" and "average gift of zero" are different facts, and a UI that
 * renders NaN has already lost.
 */
export function averageCents(total: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round(total / count);
}
