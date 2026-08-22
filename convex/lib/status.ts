/**
 * Donation status semantics -- deliberately its OWN module.
 *
 * Status is kept separate from scope filtering (campaign + date) so that
 * "in scope" never quietly comes to mean "succeeded". Scoping answers *which
 * slice of the business* you are looking at; status answers *which money is
 * real*. Conflating them is how a pending gift ends up in a total: some helper
 * called `filterDonations` starts meaning both things, and a caller that wanted
 * only the date filter silently inherits the status rule too (or worse, loses it).
 *
 * The one rule this module exists to protect:
 *   ONLY `succeeded` counts as raised. `pending`, `failed` and `refunded` do not.
 */

export const DONATION_STATUSES = ['pending', 'succeeded', 'failed', 'refunded'] as const;

export type DonationStatus = (typeof DONATION_STATUSES)[number];

/** The single source of truth for "does this money count as raised?". */
export function countsAsRaised(status: DonationStatus): boolean {
  return status === 'succeeded';
}

export type StatusPartition<T> = {
  succeeded: T[];
  pending: T[];
  failed: T[];
  refunded: T[];
};

/**
 * Splits rows by status in one pass. Returning every bucket (not just the
 * succeeded one) is what lets the stats payload answer "how much failed?"
 * without ever exposing status as a caller-supplied filter.
 */
export function partitionByStatus<T extends { status: DonationStatus }>(
  rows: readonly T[]
): StatusPartition<T> {
  const partition: StatusPartition<T> = {
    succeeded: [],
    pending: [],
    failed: [],
    refunded: [],
  };
  for (const row of rows) {
    // Unknown statuses are dropped rather than counted: stored data is never
    // trusted, and an unrecognised status must not land in `raised` by default.
    if (partition[row.status] !== undefined) partition[row.status].push(row);
  }
  return partition;
}
