import { describe, expect, it } from "vitest";
import { escapeCsvCell } from "../lib/csv";
import { getHistoryDateBounds, getHistoryMonthBounds } from "../lib/history-filters";

describe("CSV cell escaping", () => {
  it("escapes quotes and preserves ordinary values", () => {
    expect(escapeCsvCell('Driver "A"')).toBe('"Driver ""A"""');
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(123)).toBe('"123"');
  });

  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "\t=1+1", "\r=1+1"])(
    "neutralizes spreadsheet formula prefix %j",
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    },
  );

  it("does not alter formula characters that are not at the start", () => {
    expect(escapeCsvCell("Vehicle = available")).toBe('"Vehicle = available"');
  });
});

describe("history export date bounds", () => {
  it("uses the next Sydney midnight as an exclusive end bound", () => {
    expect(getHistoryDateBounds("2026-08-01", "2026-08-11")).toEqual({
      fromIso: "2026-07-31T14:00:00.000Z",
      toExclusiveIso: "2026-08-11T14:00:00.000Z",
    });
  });

  it("rolls the end date across month and year boundaries", () => {
    expect(getHistoryDateBounds("", "2026-12-31").toExclusiveIso).toBe("2026-12-31T13:00:00.000Z");
  });

  it("builds Sydney month bounds independently of table pagination", () => {
    expect(getHistoryMonthBounds("2026-08")).toEqual({
      monthStartIso: "2026-07-31T14:00:00.000Z",
      monthEndExclusiveIso: "2026-08-31T14:00:00.000Z",
    });
  });
});
