export type Vehicle = {
  id: string;
  plate_number: string;
  model: string;
  status: "available" | "borrowed" | "maintenance";
  current_holder_user_id: string | null;
};

export type LoanRow = {
  id: string;
  vehicle_id: string;
  borrowed_by_user_id: string;
  driver_name: string;
  purpose: string;
  start_odometer: number;
  end_odometer: number | null;
  borrow_notes: string | null;
  return_notes: string | null;
  borrowed_at: string;
  returned_at: string | null;
  vehicle: {
    plate_number: string;
    model: string;
  } | null;
};

export type RawLoanRow = Omit<LoanRow, "vehicle"> & {
  vehicle: Array<{
    plate_number: string;
    model: string;
  }> | null;
};

export function normalizeLoan(row: RawLoanRow): LoanRow {
  return {
    ...row,
    vehicle: row.vehicle?.[0] ?? null,
  };
}
