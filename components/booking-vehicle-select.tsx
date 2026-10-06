"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/utils";

type BorrowPeriod = {
  vehicle_id: string;
  borrower_email: string;
  borrowed_at: string;
  expected_return_at: string | null;
  is_long_term: boolean;
};

type Props = {
  vehicles: { id: string; label: string; borrowed: boolean }[];
  activeLoans: BorrowPeriod[];
  defaultVehicleId: string;
};

export function BookingVehicleSelect({ vehicles, activeLoans, defaultVehicleId }: Props) {
  const [vehicleId, setVehicleId] = useState(defaultVehicleId);
  const loans = activeLoans.filter((loan) => loan.vehicle_id === vehicleId);
  const vehicle = vehicles.find((item) => item.id === vehicleId);

  return (
    <>
      <label className="fieldLabel">
        Vehicle
        <select name="vehicleId" required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
          <option disabled value="">Select a vehicle</option>
          {vehicles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {loans.map((loan, index) => (
        <div className="message" role="status" key={`${loan.vehicle_id}-${index}`}>
          <strong>This vehicle is currently borrowed.</strong>
          <p>Borrower: {loan.borrower_email}</p>
          <p>Borrowed from: {formatDateTime(loan.borrowed_at)}</p>
          <p>Expected return: {loan.is_long_term ? "Long term — no confirmed return time" : loan.expected_return_at ? formatDateTime(loan.expected_return_at) : "No confirmed return time"}</p>
          {loan.expected_return_at && new Date(loan.expected_return_at).getTime() < Date.now() ? <p>The expected return time has passed, but the vehicle has not been recorded as returned.</p> : null}
          <p>You can still reserve this vehicle, including during this borrow period. Please coordinate availability with the current borrower before collecting the key.</p>
        </div>
      ))}
      {vehicle?.borrowed && loans.length === 0 ? <p className="message" role="status">This vehicle is currently marked as borrowed. No borrow time range is recorded. You can still reserve it; please confirm availability before collecting the key.</p> : null}
    </>
  );
}
