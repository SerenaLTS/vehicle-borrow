import { describe, expect, it } from "vitest";
import { validateBorrowForm } from "@/lib/borrow-validation";

const now = Date.parse("2026-09-11T00:00:00Z");
function validForm() {
  const form = new FormData();
  form.set("vehicleId", "vehicle");
  form.set("purpose", "Client meeting");
  form.set("expectedReturnAt", "2026-09-11T16:00");
  return form;
}

describe("borrow form validation", () => {
  it("lists all missing fields so one popup explains what to fix", () => {
    expect(validateBorrowForm(new FormData(), now).map((issue) => issue.field)).toEqual(["vehicleId", "purpose", "expectedReturnAt"]);
  });
  it("rejects whitespace-only purpose, past dates and fractional odometers", () => {
    const form = validForm();
    form.set("purpose", "   "); form.set("expectedReturnAt", "2026-09-11T09:00"); form.set("startOdometer", "25.5");
    expect(validateBorrowForm(form, now).map((issue) => issue.field)).toEqual(["purpose", "expectedReturnAt", "startOdometer"]);
  });
  it("rejects invalid dates and Sydney daylight-saving gaps", () => {
    for (const date of ["2026-09-31T16:00", "2026-10-04T02:30", "invalid"]) {
      const form = validForm(); form.set("expectedReturnAt", date);
      expect(validateBorrowForm(form, now)).toEqual([expect.objectContaining({ field: "expectedReturnAt" })]);
    }
  });
  it("permits long-term borrowing without a return date, and optional odometer", () => {
    const form = validForm(); form.delete("expectedReturnAt"); form.set("isLongTerm", "on");
    expect(validateBorrowForm(form, now)).toEqual([]);
    expect(validateBorrowForm(validForm(), now)).toEqual([]);
  });
  it("rejects negative, non-finite and overflowing odometers", () => {
    for (const value of ["-1", "Infinity", "2147483648", "abc"]) {
      const form = validForm(); form.set("startOdometer", value);
      expect(validateBorrowForm(form, now)).toEqual([expect.objectContaining({ field: "startOdometer" })]);
    }
    const form = validForm(); form.set("startOdometer", "0");
    expect(validateBorrowForm(form, now)).toEqual([]);
  });
});
