import { describe, expect, it } from "vitest";
import { escapeCsvCell } from "../lib/csv";

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
