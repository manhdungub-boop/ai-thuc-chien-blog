import { prioritizeAgentTasks } from "./agent-priority-engine.mjs";

const MAX_BATCH_ITEMS = 20;
const MAX_UNITS_PER_TASK = 20;
const MAX_DAILY_UNITS = 100;

/**
 * Fail-closed guard using abstract internal units, NOT money, tokens or provider quotas.
 * Ledger evidence must be supplied by a trusted caller; this helper has no persistence.
 */
export function evaluateAgentBudget({ ledger, requests } = {}) {
  const invalid = (error) => Object.freeze({
    ok: false,
    status: "blocked",
    error,
    approved: Object.freeze([]),
    rejected: Object.freeze([]),
    remainingUnits: null,
    sideEffects: Object.freeze([]),
  });

  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger) ||
      ledger.verified !== true ||
      typeof ledger.period !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.period) ||
      !Number.isSafeInteger(ledger.dailyLimitUnits) ||
      !Number.isSafeInteger(ledger.consumedUnits) ||
      !Number.isSafeInteger(ledger.reservedUnits)) return invalid("budget_evidence_invalid");

  if (ledger.dailyLimitUnits < 1 || ledger.dailyLimitUnits > MAX_DAILY_UNITS ||
      ledger.consumedUnits < 0 || ledger.reservedUnits < 0 ||
      ledger.consumedUnits + ledger.reservedUnits > ledger.dailyLimitUnits) {
    return invalid("budget_ledger_out_of_bounds");
  }

  if (!Array.isArray(requests) || requests.length > MAX_BATCH_ITEMS) {
    return invalid("budget_batch_invalid");
  }
  const seen = new Set();
  for (const request of requests) {
    if (!request || typeof request !== "object" || Array.isArray(request) ||
        typeof request.id !== "string" || !/^[A-Za-z0-9._:-]{1,96}$/.test(request.id) ||
        !Number.isSafeInteger(request.units) || request.units < 1 ||
        request.units > MAX_UNITS_PER_TASK || seen.has(request.id)) {
      return invalid("budget_request_invalid");
    }
    seen.add(request.id);
  }

  const priority = prioritizeAgentTasks(requests);
  if (!priority.ok) return invalid("budget_priority_validation_failed");

  let available = ledger.dailyLimitUnits - ledger.consumedUnits - ledger.reservedUnits;
  const approved = [];
  const rejected = [];
  for (const item of priority.items) {
    const request = requests.find(entry => entry.id === item.id);
    if (request.units <= available) {
      approved.push(Object.freeze({ id: item.id, type: item.type, units: request.units, priority: item.priority }));
      available -= request.units;
    } else {
      rejected.push(Object.freeze({ id: item.id, type: item.type, units: request.units, reason: "daily_unit_budget_exhausted" }));
    }
  }

  return Object.freeze({
    ok: true,
    status: rejected.length === 0 ? "within_budget" : approved.length === 0 ? "blocked" : "partially_approved",
    period: ledger.period,
    approved: Object.freeze(approved),
    rejected: Object.freeze(rejected),
    remainingUnits: available,
    unitsAreMonetary: false,
    sideEffects: Object.freeze([]),
  });
}

export const AGENT_BUDGET_POLICY = Object.freeze({
  maxBatchItems: MAX_BATCH_ITEMS,
  maxUnitsPerTask: MAX_UNITS_PER_TASK,
  maxDailyUnits: MAX_DAILY_UNITS,
  unitsMeaning: "abstract_internal_capacity_only",
  persistsReservations: false,
  chargesMoney: false,
  providerQuotaEvidence: false,
});
