/**
 * Return the UTC calendar day at execution time for persistent daily budgets.
 * Never derive quota dates from scheduled event timestamps: delayed or replayed
 * events must consume the quota for the day on which requests actually run.
 */
export function currentUtcBudgetDay(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new TypeError("invalid_budget_timestamp");
  }
  return new Date(now).toISOString().slice(0, 10);
}
