export type Vehicle = {
  id: string;
  plate_number: string;
  model: string;
  vin: string | null;
  color: string | null;
  location: string | null;
  make: string | null;
  model_year: number | null;
  vehicle_type: "sedan" | "suv" | "ute" | "truck" | "display" | "other" | null;
  department: string | null;
  fuel_type: "petrol" | "diesel" | "hybrid" | "electric" | null;
  default_parking_location: string | null;
  spare_key_location: string | null;
  current_location_name: string | null;
  current_location_address: string | null;
  location_source: "manual" | "booking" | "gps" | "admin_confirmed" | null;
  location_comments: string | null;
  location_updated_at: string | null;
  current_custodian_name: string | null;
  current_custodian_user_id: string | null;
  current_key_holder_name: string | null;
  current_key_holder_user_id: string | null;
  expected_return_or_arrival_at: string | null;
  registration_state: string | null;
  registration_expires_on: string | null;
  registration_reminder_acknowledged_at: string | null;
  insurer: string | null;
  insurance_policy_number: string | null;
  insurance_expires_on: string | null;
  inspection_expires_on: string | null;
  usage_restrictions: string | null;
  reminder_days: number;
  status: "available" | "booked" | "borrowed" | "in_transit" | "repair" | "maintenance" | "suspended" | "employee_car" | "sold" | "retired";
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
  borrow_overdue_reminded_at?: string | null;
  is_long_term: boolean;
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
  ends_at: string | null;
  is_long_term: boolean;
  comments: string | null;
  borrower_type?: "internal" | "external";
  driver_name?: string | null;
  booking_status?: "draft" | "pending_approval" | "approved" | "active" | "completed" | "cancelled" | "rejected";
  approval_status?: "not_required" | "pending" | "approved" | "rejected" | "cancelled";
  approval_notes?: string | null;
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
