import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type BookingValidationArgs = {
  vehicleId: string;
  startsAt: string;
  endsAt: string | null;
  isLongTerm?: boolean;
  excludeBookingId?: string;
};

export async function validateVehicleBookingWindow(
  supabase: SupabaseServerClient,
  { vehicleId, startsAt, endsAt, isLongTerm = false, excludeBookingId }: BookingValidationArgs,
) {
  const startsAtDate = new Date(startsAt);
  const endsAtDate = endsAt ? new Date(endsAt) : null;

  if (
    !vehicleId ||
    Number.isNaN(startsAtDate.getTime()) ||
    (!isLongTerm && endsAtDate === null) ||
    (endsAtDate !== null && (Number.isNaN(endsAtDate.getTime()) || endsAtDate <= startsAtDate))
  ) {
    return "Please choose a valid booking time range.";
  }

  const [{ data: vehicle, error: vehicleError }, { data: activeLoans, error: loanError }] = await Promise.all([
    supabase.from("vehicles").select("id, status, current_holder_user_id").eq("id", vehicleId).maybeSingle(),
    supabase
      .from("vehicle_loans")
      .select("id, borrowed_at, expected_return_at, is_long_term, returned_at")
      .eq("vehicle_id", vehicleId)
      .is("returned_at", null),
  ]);

  if (vehicleError) {
    return vehicleError.message;
  }

  if (!vehicle) {
    return "Vehicle not found.";
  }

  if (vehicle.status === "retired" || vehicle.status === "maintenance") {
    return "This vehicle cannot be booked in its current status.";
  }

  if (loanError) {
    return loanError.message;
  }

  const activeLoan = activeLoans?.[0];

  if (activeLoan) {
    if (activeLoan.is_long_term) {
      return "This vehicle is currently borrowed long term.";
    }

    if (!activeLoan.expected_return_at) {
      return "This vehicle is currently borrowed and does not have a scheduled return time yet.";
    }

    const loanStartsAt = new Date(activeLoan.borrowed_at);
    const loanEndsAt = new Date(activeLoan.expected_return_at);

    if ((endsAtDate === null || loanStartsAt < endsAtDate) && loanEndsAt > startsAtDate) {
      return "This booking overlaps with an existing borrow period.";
    }
  }

  let conflictQuery = supabase
    .from("vehicle_bookings")
    .select("id", { head: true, count: "exact" })
    .eq("vehicle_id", vehicleId)
    .lt("starts_at", isLongTerm ? "9999-12-31T23:59:59.999Z" : (endsAt ?? "9999-12-31T23:59:59.999Z"))
    .or(`is_long_term.eq.true,ends_at.gt.${startsAt}`);

  if (excludeBookingId) {
    conflictQuery = conflictQuery.neq("id", excludeBookingId);
  }

  const { count, error: conflictError } = await conflictQuery;

  if (conflictError) {
    return conflictError.message;
  }

  if ((count ?? 0) > 0) {
    return "This vehicle is already booked during the selected period.";
  }

  return null;
}
