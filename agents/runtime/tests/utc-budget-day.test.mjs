import { describe, expect, it } from "vitest";
import { currentUtcBudgetDay } from "../src/utc-budget-day.mjs";

describe("execution-day UTC budget key", () => {
  it("uses the UTC date at the time an outbound request executes", () => {
    expect(currentUtcBudgetDay(Date.parse("2026-11-19T23:59:59.000Z"))).toBe("2026-11-19");
    expect(currentUtcBudgetDay(Date.parse("2026-11-20T00:00:00.000Z"))).toBe("2026-11-20");
  });

  it("supports explicit UTC timestamps for deterministic boundary tests", () => {
    const delayedEventTimestamp = Date.parse("2026-11-01T08:00:00.000Z");
    expect(currentUtcBudgetDay(delayedEventTimestamp)).toBe("2026-11-01");
  });

  it("rejects invalid timestamps rather than creating an unbounded quota bucket", () => {
    for (const value of [-1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => currentUtcBudgetDay(value)).toThrow("invalid_budget_timestamp");
    }
  });
});
