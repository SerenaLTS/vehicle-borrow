import type { LoanRow } from "@/lib/types";

/**
 * A loan only ends when the vehicle is actually returned. For an active loan,
 * keep the calendar bar visible through today, or through the expected return
 * when that is still in the future.
 */
export function getLoanCalendarEndAt(
  loan: Pick<LoanRow, "returned_at" | "expected_return_at">,
  nowIso = new Date().toISOString(),
) {
  if (loan.returned_at) {
    return loan.returned_at;
  }

  if (loan.expected_return_at && new Date(loan.expected_return_at).getTime() > new Date(nowIso).getTime()) {
    return loan.expected_return_at;
  }

  return nowIso;
}
