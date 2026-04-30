import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { VehicleScheduleTimeline } from "@/components/vehicle-schedule-timeline";
import { createClient } from "@/lib/supabase/server";
import { formatUtcIsoForDateTimeLocalInput } from "@/lib/datetime";
import { getFleetSnapshot } from "@/lib/fleet-cache";
import { getIsAdmin } from "@/lib/user-roles";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";
import { formatDateTime, formatDisplayName, getVehicleDisplayStatus } from "@/lib/utils";
import { borrowVehicle, extendVehicleLoan } from "@/app/borrow/actions";

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

  const [isAdmin, snapshot, { data: loanData }] = await Promise.all([
    getIsAdmin(supabase, user.id),
    getFleetSnapshot(supabase),
    supabase
      .from("vehicle_loans")
      .select("id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)")
      .eq("borrowed_by_user_id", user.id)
      .is("returned_at", null)
      .order("borrowed_at", { ascending: false }),
  ]);
  const vehicles = snapshot.vehicles.filter((vehicle) => vehicle.status !== "retired" && vehicle.status !== "maintenance");
  const activeLoans = ((loanData ?? []) as RawLoanRow[]).map(normalizeLoan);
  const activeLoanVehicleIds = snapshot.activeLoanVehicleIds;
  const nextBookingByVehicleId = snapshot.nextBookingByVehicleId;

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
  const message = typeof params.message === "string" ? params.message : null;

  return (
    <AppShell
      title="Borrow"
      subtitle="Choose an available vehicle, record who is driving it, and confirm how long you need it."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref={isAdmin ? "/admin" : undefined}
      helpHref="/user-guide#borrow"
    >
      {message ? <p className="message">{message}</p> : null}

      {activeLoans.length > 0 ? (
        <>
          <section className="sectionHeader compactSectionHeader">
            <div>
              <h2>Extend active borrow</h2>
              <p className="muted">Need more time? Choose a later expected return time and explain why.</p>
            </div>
          </section>

          <div className="cardsGrid">
            {activeLoans.map((loan) => (
              <article className="vehicleCard" key={loan.id}>
                <StatusPill status="borrowed" />
                <h3>{loan.vehicle?.plate_number ?? "Unknown vehicle"}</h3>
                <p className="muted">{loan.vehicle?.model ?? "Vehicle"}</p>
                <div className="vehicleMeta">
                  <span>Purpose: {loan.purpose}</span>
                  <span>Borrowed: {formatDateTime(loan.borrowed_at)}</span>
                  <span>Current expected return: {formatDateTime(loan.expected_return_at)}</span>
                </div>

                <form action={extendVehicleLoan} className="extensionForm">
                  <input name="loanId" type="hidden" value={loan.id} />
                  <input name="returnTo" type="hidden" value="/borrow" />
                  <label className="fieldLabel">
                    New expected return time
                    <input defaultValue={formatUtcIsoForDateTimeLocalInput(loan.expected_return_at)} name="expectedReturnAt" required type="datetime-local" />
                  </label>
                  <label className="fieldLabel">
                    Reason
                    <textarea name="extensionReason" placeholder="Explain why more time is needed..." required />
                  </label>
                  <SubmitButton className="secondaryButton" idleLabel="Extend" pendingLabel="Checking..." />
                </form>
              </article>
            ))}
          </div>
        </>
      ) : null}

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
                    {vehicle.color ? ` • ${vehicle.color}` : ""}
                    {vehicle.vin ? ` • VIN ${vehicle.vin}` : ""}
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
        {availableVehicles.map((vehicle) => {
          const nextBooking = nextBookingByVehicleId.get(vehicle.id);
          const hasUpcomingBooking = nextBooking ? new Date(nextBooking.starts_at).getTime() > now : false;

          return (
            <article className="vehicleCard" key={vehicle.id}>
              <StatusPill status={hasUpcomingBooking ? "booked" : "available"} />
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
              ) : null}
              <VehicleScheduleTimeline basePath="/borrow" vehicleId={vehicle.id} />
            </article>
          );
        })}
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
                {vehicle.vin || vehicle.color ? (
                  <div className="vehicleMeta">
                    <span>VIN: {vehicle.vin || "-"}</span>
                    <span>Color: {vehicle.color || "-"}</span>
                  </div>
                ) : null}
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
                <VehicleScheduleTimeline basePath="/borrow" vehicleId={vehicle.id} />
              </article>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
