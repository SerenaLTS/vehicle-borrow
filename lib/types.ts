export type Vehicle = {
  id: string;
  plate_number: string;
  model: string;
  vin: string | null;
  color: string | null;
  status: "available" | "booked" | "borrowed" | "maintenance" | "retired";
  comments: string | null;
  current_holder_user_id: string | null;
};

export type LoanRow = {
  id: string;
  vehicle_id: string;
  borrowed_by_user_id: string;
  borrower_email: string;
  driver_name: string;
  purpose: string;
  start_odometer: number | null;
  end_odometer: number | null;
  borrow_notes: string | null;
  return_notes: string | null;
  borrowed_at: string;
  expected_return_at: string | null;
  returned_at: string | null;
  vehicle: {
    plate_number: string;
    model: string;
  } | null;
};

export type RawLoanRow = Omit<LoanRow, "vehicle"> & {
  vehicle:
    | {
        plate_number: string;
        model: string;
      }
    | Array<{
        plate_number: string;
        model: string;
      }>
    | null;
};

export function normalizeLoan(row: RawLoanRow): LoanRow {
  return {
    ...row,
    vehicle: Array.isArray(row.vehicle) ? row.vehicle[0] ?? null : row.vehicle,
  };
}

export type LoanExtension = {
  id: string;
  loan_id: string;
  vehicle_id: string;
  extended_by_user_id: string;
  previous_expected_return_at: string | null;
  new_expected_return_at: string;
  reason: string;
  created_at: string;
};

export type VehicleBooking = {
  id: string;
  vehicle_id: string;
  booked_by_user_id: string;
  booked_by_email: string;
  starts_at: string;
  ends_at: string;
  comments: string | null;
  created_at: string;
  vehicle: {
    plate_number: string;
    model: string;
  } | null;
};

export type RawVehicleBooking = Omit<VehicleBooking, "vehicle"> & {
  vehicle:
    | {
        plate_number: string;
        model: string;
      }
    | Array<{
        plate_number: string;
        model: string;
      }>
    | null;
};

export function normalizeVehicleBooking(row: RawVehicleBooking): VehicleBooking {
  return {
    ...row,
    vehicle: Array.isArray(row.vehicle) ? row.vehicle[0] ?? null : row.vehicle,
  };
}
