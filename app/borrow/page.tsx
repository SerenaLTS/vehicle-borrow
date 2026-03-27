import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { normalizeVehicleBooking, type RawVehicleBooking, type Vehicle } from "@/lib/types";
import { formatDateTime, formatDisplayName, getVehicleDisplayStatus } from "@/lib/utils";
import { borrowVehicle } from "@/app/borrow/actions";

type BorrowPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BorrowPage({ searchParams }: BorrowPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const isAdmin = await getIsAdmin(supabase, user.id);

  const [{ data: vehicleData }, { data: bookingData }, { data: activeLoanData }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, model, status, comments, current_holder_user_id")
      .not("status", "in", '("retired","maintenance")')
      .order("plate_number"),
    supabase
      .from("vehicle_bookings")
      .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true }),
    supabase.from("vehicle_loans").select("vehicle_id").is("returned_at", null),
  ]);

  const vehicles = (vehicleData ?? []) as Vehicle[];
  const upcomingBookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
  const activeLoanVehicleIds = new Set((activeLoanData ?? []).map((loan) => loan.vehicle_id));
  const nextBookingByVehicleId = new Map<string, (typeof upcomingBookings)[number]>();

  for (const booking of upcomingBookings) {
    if (!nextBookingByVehicleId.has(booking.vehicle_id)) {
      nextBookingByVehicleId.set(booking.vehicle_id, booking);
    }
  }

  const now = Date.now();
  const availableVehicles = vehicles.filter((vehicle) => {
    const nextBooking = nextBookingByVehicleId.get(vehicle.id);
    const isBookingActive = nextBooking ? new Date(nextBooking.starts_at).getTime() <= now && new Date(nextBooking.ends_at).getTime() > now : false;
    const displayStatus = getVehicleDisplayStatus({
      storedStatus: vehicle.status,
      hasActiveLoan: activeLoanVehicleIds.has(vehicle.id),
      hasActiveBooking: isBookingActive,
    });

    return displayStatus === "available";
  });

  const bookedVehicles = vehicles.filter((vehicle) => {
    const nextBooking = nextBookingByVehicleId.get(vehicle.id);
    const isBookingActive = nextBooking ? new Date(nextBooking.starts_at).getTime() <= now && new Date(nextBooking.ends_at).getTime() > now : false;
    const displayStatus = getVehicleDisplayStatus({
      storedStatus: vehicle.status,
      hasActiveLoan: activeLoanVehicleIds.has(vehicle.id),
      hasActiveBooking: isBookingActive,
    });

    return displayStatus === "booked";
  });
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <AppShell
      title="Borrow"
      subtitle="Choose an available vehicle, record who is driving it, and confirm how long you need it."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="panel">
        <h2>Borrow a vehicle</h2>
        <p className="muted">Borrowing requires an expected return time. If that window overlaps an existing booking, the system will block the borrow automatically.</p>

        {availableVehicles.length === 0 ? (
          <div className="emptyState">No vehicles are available right now.</div>
        ) : (
          <form action={borrowVehicle}>
            <label className="fieldLabel">
              Borrowing as
              <input defaultValue={user.email ?? ""} disabled />
            </label>

            <label className="fieldLabel">
              Vehicle
              <select name="vehicleId" required defaultValue="">
                <option disabled value="">
                  Select a vehicle
                </option>
                {availableVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plate_number} • {vehicle.model}
                  </option>
                ))}
              </select>
            </label>

            <div className="formGrid">
              <label className="fieldLabel">
                Driver (if applicable)
                <input name="driverName" placeholder="Influencer or other driver name" />
              </label>
              <label className="fieldLabel">
                Purpose
                <input name="purpose" placeholder="Client visit, airport pickup..." required />
              </label>
            </div>

            <label className="fieldLabel">
              Expected return time
              <input name="expectedReturnAt" required type="datetime-local" />
            </label>

            <label className="fieldLabel">
              Current odometer (km)
              <input min="0" name="startOdometer" type="number" />
            </label>

            <label className="fieldLabel">
              Notes
              <textarea name="borrowNotes" placeholder="Optional booking notes" />
            </label>

            <SubmitButton className="primaryButton" idleLabel="Confirm borrow" pendingLabel="Saving..." />
          </form>
        )}

        {error ? <p className="message error">{error}</p> : null}
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Available now</h2>
          <p className="muted">Snapshot of vehicles that can be borrowed immediately.</p>
        </div>
      </section>

      <div className="cardsGrid">
        {availableVehicles.map((vehicle) => (
          <article className="vehicleCard" key={vehicle.id}>
            <StatusPill status="available" />
            <h3>{vehicle.plate_number}</h3>
            <p className="muted">{vehicle.model}</p>
          </article>
        ))}
      </div>

      {bookedVehicles.length > 0 ? (
        <>
          <section className="sectionHeader">
            <div>
              <h2>Booked</h2>
              <p className="muted">These vehicles are currently reserved and cannot be borrowed from this page.</p>
            </div>
          </section>

          <div className="cardsGrid">
            {bookedVehicles.map((vehicle) => (
              <article className="vehicleCard" key={vehicle.id}>
                <StatusPill status="booked" />
                <h3>{vehicle.plate_number}</h3>
                <p className="muted">{vehicle.model}</p>
                {(() => {
                  const booking = nextBookingByVehicleId.get(vehicle.id);

                  if (!booking) {
                    return vehicle.comments ? (
                      <div className="vehicleMeta">
                        <span>{vehicle.comments}</span>
                      </div>
                    ) : null;
                  }

                  return (
                    <div className="vehicleMeta">
                      <span>Booked by: {booking.booked_by_email}</span>
                      <span>From: {formatDateTime(booking.starts_at)}</span>
                      <span>Until: {formatDateTime(booking.ends_at)}</span>
                      <span>Comments: {booking.comments || "-"}</span>
                    </div>
                  );
                })()}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
