import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ConfirmForm } from "@/components/confirm-form";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { cancelOwnBooking, collectBookingKey, createBooking, updateOwnBooking } from "@/app/book/actions";
import { VehicleScheduleTimeline } from "@/components/vehicle-schedule-timeline";
import { createClient } from "@/lib/supabase/server";
import { formatUtcIsoForDateTimeLocalInput } from "@/lib/datetime";
import { getFleetSnapshot } from "@/lib/fleet-cache";
import { getIsAdmin } from "@/lib/user-roles";
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

  const [isAdmin, snapshot] = await Promise.all([getIsAdmin(supabase, user.id), getFleetSnapshot(supabase)]);
  const fleet = snapshot.vehicles;
  const upcomingBookings = snapshot.upcomingBookings;
  const activeLoanVehicleIds = snapshot.activeLoanVehicleIds;
  const nextBookingByVehicleId = snapshot.nextBookingByVehicleId;

  const bookableVehicles = fleet.filter((vehicle) => vehicle.status !== "retired" && vehicle.status !== "maintenance");
  const error = typeof params.error === "string" ? params.error : null;
  const message = typeof params.message === "string" ? params.message : null;
  const yourBookings = upcomingBookings.filter((booking) => booking.booked_by_user_id === user.id);
  const now = Date.now();

  return (
    <AppShell
      title="Reserve"
      subtitle="Reserve a vehicle for a future time window."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref={isAdmin ? "/admin" : undefined}
      helpHref="/user-guide#book"
    >
      {message ? <p className="message">{message}</p> : null}

      <section className="panel">
        <h2>Reserve a vehicle</h2>
        <p className="muted">Reservations hold a time slot. Vehicles that are currently borrowed can still be reserved for later; if the previous borrower has not returned it by your reservation time, both people will be notified to coordinate.</p>

        {bookableVehicles.length === 0 ? (
          <div className="emptyState">No vehicles can be booked right now.</div>
        ) : (
          <form action={createBooking}>
            <label className="fieldLabel">
              Reserved by
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
                    {activeLoanVehicleIds.has(vehicle.id) ? " • currently borrowed" : ""}
                    {vehicle.color ? ` • ${vehicle.color}` : ""}
                    {vehicle.location ? ` • ${vehicle.location}` : ""}
                    {vehicle.vin ? ` • VIN ${vehicle.vin}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="formGrid">
              <div className="timeFieldGroup">
                <label className="fieldLabel">
                  Start time
                  <input name="startsAt" required type="datetime-local" />
                </label>

                <label className="checkboxLabel">
                  <input name="isLongTerm" type="checkbox" />
                  <span>Long term</span>
                </label>
                <p className="fieldHint">Long term reservations will notify admins.</p>
              </div>

              <label className="fieldLabel longTermHidden">
                End time
                <input name="endsAt" type="datetime-local" />
              </label>
            </div>

            <label className="fieldLabel">
              Comments
              <textarea name="comments" placeholder="Campaign shoot, airport pickup, client use..." />
            </label>

            <SubmitButton className="primaryButton" idleLabel="Create reservation" pendingLabel="Saving..." />
          </form>
        )}

        {error ? <p className="message error">{error}</p> : null}
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Your reservations</h2>
          <p className="muted">Before the reservation starts, you can adjust the time window, update comments, or cancel it.</p>
        </div>
      </section>

      {yourBookings.length === 0 ? (
        <div className="emptyState">You do not have any upcoming reservations right now.</div>
      ) : (
        <div className="cardsGrid">
          {yourBookings.map((booking) => {
            const hasStarted = new Date(booking.starts_at).getTime() <= now;

            return (
              <article className="vehicleCard" id={`booking-${booking.id}`} key={booking.id}>
                <StatusPill status="booked" />
                <h3>{booking.vehicle?.plate_number ?? "Unknown vehicle"}</h3>
                <p className="muted">{booking.vehicle?.model ?? "Vehicle"}</p>
                <div className="vehicleMeta">
                  <span>From: {formatDateTime(booking.starts_at)}</span>
                  <span>Until: {booking.is_long_term ? "Long term" : formatDateTime(booking.ends_at)}</span>
                  <span>Comments: {booking.comments || "-"}</span>
                  <span>Created: {formatDateTime(booking.created_at)}</span>
                </div>

                <ConfirmForm action={collectBookingKey} confirmMessage="Confirm you have collected the key and want to start this borrow?">
                  <input name="bookingId" type="hidden" value={booking.id} />
                  <input name="vehicleId" type="hidden" value={booking.vehicle_id} />
                  <SubmitButton className="primaryButton" idleLabel="Start borrow" pendingLabel="Starting..." />
                </ConfirmForm>

                {hasStarted ? (
                  <p className="muted">This reservation has already started, so only Start borrow is available here.</p>
                ) : (
                  <>
                    <ConfirmForm action={updateOwnBooking} confirmMessage="Confirm updating this reservation?">
                      <input name="bookingId" type="hidden" value={booking.id} />
                      <input name="vehicleId" type="hidden" value={booking.vehicle_id} />

                      <div className="formGrid">
                        <label className="fieldLabel">
                          Start time
                          <input defaultValue={formatUtcIsoForDateTimeLocalInput(booking.starts_at)} name="startsAt" required type="datetime-local" />
                        </label>
                        <label className="fieldLabel longTermHidden">
                          End time
                          <input defaultValue={formatUtcIsoForDateTimeLocalInput(booking.ends_at)} name="endsAt" type="datetime-local" />
                        </label>
                      </div>

                      <label className="checkboxLabel">
                        <input defaultChecked={booking.is_long_term} name="isLongTerm" type="checkbox" />
                        <span>Long term</span>
                      </label>
                      <p className="fieldHint">Long term reservations will notify admins.</p>

                      <label className="fieldLabel">
                        Comments
                        <textarea defaultValue={booking.comments ?? ""} name="comments" />
                      </label>

                      <div className="actionsRow">
                        <SubmitButton className="primaryButton" idleLabel="Update reservation" pendingLabel="Saving..." />
                      </div>
                    </ConfirmForm>

                    <ConfirmForm action={cancelOwnBooking} confirmMessage="Confirm cancelling this reservation?">
                      <input name="bookingId" type="hidden" value={booking.id} />
                      <input name="vehicleId" type="hidden" value={booking.vehicle_id} />
                      <SubmitButton className="ghostButton" idleLabel="Cancel reservation" pendingLabel="Cancelling..." />
                    </ConfirmForm>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      <section className="sectionHeader">
        <div>
          <h2>Fleet reservation snapshot</h2>
          <p className="muted">Shows the next active or upcoming reservation for each vehicle.</p>
        </div>
      </section>

      <div className="cardsGrid">
        {fleet.map((vehicle) => {
          const nextBooking = nextBookingByVehicleId.get(vehicle.id);
          const hasUpcomingBooking = nextBooking ? nextBooking.is_long_term || (nextBooking.ends_at ? new Date(nextBooking.ends_at).getTime() > now : false) : false;
          const displayStatus = getVehicleDisplayStatus({
            storedStatus: vehicle.status,
            hasActiveLoan: activeLoanVehicleIds.has(vehicle.id),
            hasCurrentHolder: Boolean(vehicle.current_holder_user_id),
            hasActiveBooking: hasUpcomingBooking,
          });

          return (
            <article className="vehicleCard" key={vehicle.id}>
              <StatusPill status={displayStatus} />
              <h3>{vehicle.plate_number}</h3>
              <p className="muted">{vehicle.model}</p>
              {vehicle.vin || vehicle.color || vehicle.location ? (
                <div className="vehicleMeta">
                  <span>VIN: {vehicle.vin || "-"}</span>
                  <span>Color: {vehicle.color || "-"}</span>
                  <span>Location: {vehicle.location || "-"}</span>
                </div>
              ) : null}
              {nextBooking ? (
                <div className="vehicleMeta">
                  <span>Booked by: {nextBooking.booked_by_email}</span>
                  <span>From: {formatDateTime(nextBooking.starts_at)}</span>
                  <span>Until: {nextBooking.is_long_term ? "Long term" : formatDateTime(nextBooking.ends_at)}</span>
                  <span>Comments: {nextBooking.comments || "-"}</span>
                </div>
              ) : (
                <div className="vehicleMeta">
                  <span>{vehicle.comments || "No upcoming reservation recorded."}</span>
                </div>
              )}
              <VehicleScheduleTimeline basePath="/book" vehicleId={vehicle.id} />
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
