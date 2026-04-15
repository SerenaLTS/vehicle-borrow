import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { createBooking } from "@/app/book/actions";
import { createClient } from "@/lib/supabase/server";
import { getVehicleOptionalFieldSupport, getVehicleSelectClause } from "@/lib/vehicle-schema";
import { getIsAdmin } from "@/lib/user-roles";
import { normalizeVehicleBooking, type RawVehicleBooking, type Vehicle } from "@/lib/types";
import { formatDateTime, formatDisplayName, getVehicleDisplayStatus } from "@/lib/utils";

type BookPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BookPage({ searchParams }: BookPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const isAdmin = await getIsAdmin(supabase, user.id);
  const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);

  const [{ data: vehicles }, { data: bookingData }, { data: activeLoanData }] = await Promise.all([
    supabase.from("vehicles").select(getVehicleSelectClause(optionalFieldSupport)).order("plate_number"),
    supabase
      .from("vehicle_bookings")
      .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true }),
    supabase.from("vehicle_loans").select("vehicle_id").is("returned_at", null),
  ]);

  const fleet = ((vehicles ?? []) as unknown[]) as Vehicle[];
  const upcomingBookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
  const activeLoanVehicleIds = new Set((activeLoanData ?? []).map((loan) => loan.vehicle_id));
  const nextBookingByVehicleId = new Map<string, (typeof upcomingBookings)[number]>();

  for (const booking of upcomingBookings) {
    if (!nextBookingByVehicleId.has(booking.vehicle_id)) {
      nextBookingByVehicleId.set(booking.vehicle_id, booking);
    }
  }

  const bookableVehicles = fleet.filter((vehicle) => vehicle.status !== "retired" && vehicle.status !== "maintenance" && !activeLoanVehicleIds.has(vehicle.id));
  const error = typeof params.error === "string" ? params.error : null;
  const now = Date.now();

  return (
    <AppShell
      title="Book"
      subtitle="Reserve a vehicle for a specific time window before someone else borrows it."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="panel">
        <h2>Book a vehicle</h2>
        <p className="muted">Bookings reserve a time slot. Borrowing will be blocked automatically if it overlaps with an existing booking.</p>

        {bookableVehicles.length === 0 ? (
          <div className="emptyState">No vehicles can be booked right now.</div>
        ) : (
          <form action={createBooking}>
            <label className="fieldLabel">
              Booked by
              <input defaultValue={user.email ?? ""} disabled />
            </label>

            <label className="fieldLabel">
              Vehicle
              <select name="vehicleId" required defaultValue="">
                <option disabled value="">
                  Select a vehicle
                </option>
                {bookableVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plate_number} • {vehicle.model}
                    {vehicle.color ? ` • ${vehicle.color}` : ""}
                    {vehicle.vin ? ` • VIN ${vehicle.vin}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="formGrid">
              <label className="fieldLabel">
                Start time
                <input name="startsAt" required type="datetime-local" />
              </label>

              <label className="fieldLabel">
                End time
                <input name="endsAt" required type="datetime-local" />
              </label>
            </div>

            <label className="fieldLabel">
              Comments
              <textarea name="comments" placeholder="Campaign shoot, airport pickup, client use..." />
            </label>

            <SubmitButton className="primaryButton" idleLabel="Create booking" pendingLabel="Saving..." />
          </form>
        )}

        {error ? <p className="message error">{error}</p> : null}
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Fleet booking snapshot</h2>
          <p className="muted">Shows the next active or upcoming booking for each vehicle.</p>
        </div>
      </section>

      <div className="cardsGrid">
        {fleet.map((vehicle) => {
          const nextBooking = nextBookingByVehicleId.get(vehicle.id);
          const isBookingActive = nextBooking ? new Date(nextBooking.starts_at).getTime() <= now && new Date(nextBooking.ends_at).getTime() > now : false;
          const displayStatus = getVehicleDisplayStatus({
            storedStatus: vehicle.status,
            hasActiveLoan: activeLoanVehicleIds.has(vehicle.id),
            hasActiveBooking: isBookingActive,
          });

          return (
            <article className="vehicleCard" key={vehicle.id}>
              <StatusPill status={displayStatus} />
              <h3>{vehicle.plate_number}</h3>
              <p className="muted">{vehicle.model}</p>
              {vehicle.vin || vehicle.color ? (
                <div className="vehicleMeta">
                  <span>VIN: {vehicle.vin || "-"}</span>
                  <span>Color: {vehicle.color || "-"}</span>
                </div>
              ) : null}
              {nextBooking ? (
                <div className="vehicleMeta">
                  <span>Booked by: {nextBooking.booked_by_email}</span>
                  <span>From: {formatDateTime(nextBooking.starts_at)}</span>
                  <span>Until: {formatDateTime(nextBooking.ends_at)}</span>
                  <span>Comments: {nextBooking.comments || "-"}</span>
                </div>
              ) : (
                <div className="vehicleMeta">
                  <span>{vehicle.comments || "No upcoming booking recorded."}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
