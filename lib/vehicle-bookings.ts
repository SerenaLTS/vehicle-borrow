import { createClient } from "@/lib/supabase/server";
import { getSafeActionErrorMessage } from "@/lib/action-errors";

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

  const { data: vehicle, error: vehicleError } = await supabase.from("vehicles").select("id, status, current_holder_user_id").eq("id", vehicleId).maybeSingle();

  if (vehicleError) {
    return getSafeActionErrorMessage(vehicleError, "Unable to check this vehicle. Please try again.", "booking:validate vehicle");
  }

  if (!vehicle) {
    return "Vehicle not found.";
  }

  if (["retired", "sold", "deregistered", "maintenance", "repair", "suspended", "employee_car", "in_transit"].includes(vehicle.status)) {
    return "This vehicle cannot be booked in its current status.";
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
    return getSafeActionErrorMessage(conflictError, "Unable to check reservation availability. Please try again.", "booking:validate availability");
  }

  if ((count ?? 0) > 0) {
    return "This vehicle is already booked during the selected period.";
  }

  return null;
}
