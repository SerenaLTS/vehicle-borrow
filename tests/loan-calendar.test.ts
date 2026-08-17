import { describe, expect, it } from "vitest";
import { getLoanCalendarEndAt } from "@/lib/loan-calendar";

describe("getLoanCalendarEndAt", () => {
  const now = "2026-08-17T02:00:00.000Z";

  it("uses the actual return time for a returned loan", () => {
    expect(getLoanCalendarEndAt({ returned_at: "2026-08-15T01:00:00.000Z", expected_return_at: "2026-08-14T01:00:00.000Z" }, now))
      .toBe("2026-08-15T01:00:00.000Z");
  });

  it("keeps an overdue active loan visible through now", () => {
    expect(getLoanCalendarEndAt({ returned_at: null, expected_return_at: "2026-08-14T01:00:00.000Z" }, now)).toBe(now);
  });

  it("shows an active loan through a future expected return", () => {
    expect(getLoanCalendarEndAt({ returned_at: null, expected_return_at: "2026-08-20T01:00:00.000Z" }, now))
      .toBe("2026-08-20T01:00:00.000Z");
  });

  it("keeps an active long-term loan visible through now", () => {
    expect(getLoanCalendarEndAt({ returned_at: null, expected_return_at: null }, now)).toBe(now);
  });
});
