"use client";

import { useRef } from "react";
import { adminReturnVehicle } from "@/app/admin/actions";
import { ConfirmForm } from "@/components/confirm-form";
import { SubmitButton } from "@/components/submit-button";
import type { LoanRow } from "@/lib/types";

export type ReturnableLoan = Pick<LoanRow, "id" | "vehicle_id" | "start_odometer" | "returned_at">;

export function AdminLoanReturn({ loan, compact = false, label }: { loan: ReturnableLoan; compact?: boolean; label?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  if (loan.returned_at) return null;

  const form = <ConfirmForm action={adminReturnVehicle} className="extensionForm" confirmMessage="Confirm admin return? This will close the active borrow record and update the vehicle's availability.">
      <input name="vehicleId" type="hidden" value={loan.vehicle_id} />
      <input name="loanId" type="hidden" value={loan.id} />
      <label className="fieldLabel">Return odometer
        <input min={loan.start_odometer ?? 0} name="endOdometer" placeholder={loan.start_odometer !== null ? `${loan.start_odometer}` : "Optional"} type="number" />
      </label>
      <label className="fieldLabel">Current vehicle location
        <input name="vehicleLocation" placeholder="e.g. P4-276" required />
        <span className="fieldHint">If parked at the office, use the P4-276 format.</span>
      </label>
      <label className="fieldLabel">Admin return note
        <textarea name="returnNotes" placeholder="Borrower forgot to return in system, confirmed key/vehicle returned..." required />
      </label>
      <SubmitButton className="primaryButton" idleLabel="Return vehicle" pendingLabel="Returning..." />
    </ConfirmForm>;

  if (compact) return <>
    <button className="adminReturnTrigger" type="button" onClick={() => dialog.current?.showModal()} aria-label={label ? `Admin return: ${label}` : "Admin return"}>Admin return</button>
    <dialog ref={dialog} className="adminReturnDialog" aria-label="Admin return">
      <button className="secondaryButton" type="button" onClick={() => dialog.current?.close()}>Close</button>
      <h3>Admin return</h3>
      {label ? <p>{label}</p> : null}
      {form}
    </dialog>
  </>;

  return <details className="extensionDisclosure adminReturnDisclosure"><summary>Admin return</summary>{form}</details>;
}
