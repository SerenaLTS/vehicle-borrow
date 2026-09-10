import { describe, expect, it } from "vitest";
import { buildFineEmail, isSingleEmail, matchingFineDrivers, parseFineAmount, parseFineDateTime, type FineDriverRecord } from "@/lib/fine-notices";

const records: FineDriverRecord[] = [
  { id: "morning", source: "loan", driverName: "A", driverEmail: "a@example.com", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-01T02:00:00Z" },
  { id: "afternoon", source: "history", driverName: "B", driverEmail: "b@example.com", startsAt: "2026-09-01T02:00:00Z", endsAt: "2026-09-01T06:00:00Z" },
];

describe("fine notice driver matching", () => {
  it("matches the actual instant, assigning handover time to the next driver", () => {
    expect(matchingFineDrivers(records, "2026-09-01T01:59:00Z").map((r) => r.id)).toEqual(["morning"]);
    expect(matchingFineDrivers(records, "2026-09-01T02:00:00Z").map((r) => r.id)).toEqual(["afternoon"]);
    expect(matchingFineDrivers(records, "2026-09-02T02:00:00Z")).toEqual([]);
  });
  it("returns all overlapping candidates instead of guessing", () => {
    expect(matchingFineDrivers([...records, { ...records[0], id: "open", endsAt: null }], "2026-09-01T03:00:00Z").map((r) => r.id)).toEqual(["afternoon", "open"]);
  });
});

describe("fine notice validation and emails", () => {
  it("parses Sydney winter and summer time and rejects invalid or skipped local dates", () => {
    expect(parseFineDateTime("2026-09-01T10:00")).toBe("2026-09-01T00:00:00.000Z");
    expect(parseFineDateTime("2026-01-01T10:00")).toBe("2025-12-31T23:00:00.000Z");
    expect(parseFineDateTime("2026-02-30T10:00")).toBeNull();
    expect(parseFineDateTime("2026-10-04T02:30")).toBeNull();
    expect(parseFineDateTime("bad")).toBeNull();
  });
  it("stores money in cents and rejects malformed, negative, zero and oversized amounts", () => {
    expect(parseFineAmount("123.45")).toBe(12345);
    expect(parseFineAmount("0.29")).toBe(29);
    expect(parseFineAmount("100.5")).toBe(10050);
    for (const value of ["0", "-1", "1.001", "1e3", "10000000", "NaN", ""]) expect(parseFineAmount(value)).toBeNull();
  });
  it("accepts one mailbox only", () => {
    expect(isSingleEmail("driver+fleet@example.com")).toBe(true);
    for (const value of ["a@example.com,b@example.com", "a@example.com\r\nBcc:b@example.com", "Name <a@example.com>", "a@example.com;b@example.com"]) expect(isSingleEmail(value)).toBe(false);
  });
  it("includes offence details and only the selected licence instruction", () => {
    const fine = { notice_number: "N123", occurred_at: "2026-09-01T01:30:00Z", location: "George Street", reason: "Parking", amount_cents: 12345, rego: "ABC123", driver_name: "Sam", requires_licence: true };
    const request = buildFineEmail(fine, true);
    expect(request.subject).toContain("N123");
    for (const text of ["ABC123", "George Street", "Parking", "123.45", "11:30", "Australia/Sydney", "Please reply", "PDF copy"]) expect(request.text).toContain(text);
    expect(request.text).not.toContain("already have");
    const onFile = buildFineEmail({ ...fine, requires_licence: false }, false);
    expect(onFile.text).toContain("already have a copy");
    expect(onFile.text).not.toContain("Please reply");
    expect(onFile.text).not.toContain("PDF copy");
  });
});
