import { formatUtcIsoForDateTimeLocalInput, parseDateTimeLocalToUtcIso } from "@/lib/datetime";

export type BorrowValidationIssue = { field: string; message: string };

export function validateBorrowForm(form: FormData, now = Date.now()): BorrowValidationIssue[] {
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const issues: BorrowValidationIssue[] = [];
  if (!value("vehicleId")) issues.push({ field: "vehicleId", message: "Vehicle: select a vehicle." });
  if (!value("purpose")) issues.push({ field: "purpose", message: "Purpose: enter the reason for borrowing the vehicle." });
  if (form.get("isLongTerm") !== "on") {
    const local = value("expectedReturnAt");
    const iso = parseDateTimeLocalToUtcIso(local);
    if (!iso || formatUtcIsoForDateTimeLocalInput(iso) !== local || Date.parse(iso) <= now) {
      issues.push({ field: "expectedReturnAt", message: "Expected return time: choose a valid future date and time, or select Long term." });
    }
  }
  const odometer = value("startOdometer");
  if (odometer && (!Number.isInteger(Number(odometer)) || Number(odometer) < 0 || Number(odometer) > 2147483647)) {
    issues.push({ field: "startOdometer", message: "Current odometer: enter a whole number from 0 to 2,147,483,647, or leave it blank." });
  }
  return issues;
}
