import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ConfirmForm } from "@/components/confirm-form";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { VehicleMonthlyCalendar } from "@/components/vehicle-monthly-calendar";
import { createAdminBooking, createHistoricalLoan, deleteAdminBooking, updateAdminBooking, updateHistoricalLoan } from "@/app/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { formatUtcIsoForDateTimeLocalInput } from "@/lib/datetime";
import { getVehicleOptionalFieldSupport, getVehicleSelectClause } from "@/lib/vehicle-schema";
import { getIsAdmin, type UserRole } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName, getVehicleDisplayStatus } from "@/lib/utils";
import { normalizeLoan, normalizeVehicleBooking, type RawLoanRow, type RawVehicleBooking, type Vehicle } from "@/lib/types";
import type { VehicleCalendarEvent } from "@/lib/vehicle-calendar-cache";

type VehicleRecordPageProps = {
  params: Promise<{
    vehicleId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VehicleRecordPage({ params, searchParams }: VehicleRecordPageProps) {
  const { vehicleId } = await params;
  const pageParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const [isAdmin, optionalFieldSupport] = await Promise.all([getIsAdmin(supabase, user.id), getVehicleOptionalFieldSupport(supabase)]);

  if (!isAdmin) {
    redirect("/dashboard?message=Admin access required.");
  }

  const [
    { data: vehicle, error: vehicleError },
    { data: loanData, error: loansError },
    { data: bookingData, error: bookingError },
    { data: roleData, error: rolesError },
  ] = await Promise.all([
    supabase
      .from("vehicles")
      .select(getVehicleSelectClause(optionalFieldSupport))
      .eq("id", vehicleId)
      .maybeSingle(),
    supabase
      .from("vehicle_loans")
      .select(
        "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)",
      )
      .eq("vehicle_id", vehicleId)
      .order("borrowed_at", { ascending: false }),
    supabase
      .from("vehicle_bookings")
      .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
      .eq("vehicle_id", vehicleId)
      .order("starts_at", { ascending: true }),
    supabase.from("user_roles").select("user_id, email, is_admin, created_at, updated_at").order("email"),
  ]);

  if (vehicleError) {
    redirect(`/admin?error=${encodeURIComponent(vehicleError.message)}`);
  }

  if (!vehicle) {
    redirect("/admin?error=Vehicle not found.");
  }

  if (loansError) {
    redirect(`/admin?error=${encodeURIComponent(loansError.message)}`);
  }

  if (bookingError) {
    redirect(`/admin?error=${encodeURIComponent(bookingError.message)}`);
  }

  if (rolesError) {
    redirect(`/admin?error=${encodeURIComponent(rolesError.message)}`);
  }

  const record = vehicle as unknown as Vehicle;
  const history = ((loanData ?? []) as RawLoanRow[]).map(normalizeLoan);
  const userRoles = (roleData ?? []) as UserRole[];
  const defaultBorrowerUserId = userRoles.some((role) => role.user_id === user.id) ? user.id : "";
  const currentLoan = history.find((loan) => loan.returned_at === null) ?? null;
  const bookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
  const now = Date.now();
  const currentYear = new Date().getFullYear();
  const requestedMonth = typeof pageParams.month === "string" && /^\d{4}-\d{2}$/.test(pageParams.month) ? pageParams.month : undefined;
  const loadedYear = Number((requestedMonth ?? `${currentYear}-01`).slice(0, 4));
  const currentBooking = bookings.find((booking) => new Date(booking.starts_at).getTime() <= now && new Date(booking.ends_at).getTime() > now) ?? null;
  const nextUpcomingBooking = bookings.find((booking) => new Date(booking.starts_at).getTime() > now) ?? null;
  const calendarEvents: VehicleCalendarEvent[] = [
    ...bookings.map((booking) => ({
      id: booking.id,
      kind: "booked" as const,
      actor: booking.booked_by_email,
      startAt: booking.starts_at,
      endAt: booking.ends_at,
      notes: booking.comments ?? null,
    })),
    ...history.map((loan) => ({
      id: loan.id,
      kind: "borrowed" as const,
      actor: loan.borrower_email,
      startAt: loan.borrowed_at,
      endAt: loan.returned_at ?? loan.expected_return_at ?? new Date().toISOString(),
      notes: loan.purpose || loan.borrow_notes || null,
    })),
  ].filter((event) => {
    const eventYearStart = Number(event.startAt.slice(0, 4));
    const eventYearEnd = Number((event.endAt ?? event.startAt).slice(0, 4));
    return eventYearStart <= loadedYear && eventYearEnd >= loadedYear;
  });
  const initialMonth = requestedMonth;
  const displayStatus = getVehicleDisplayStatus({
    storedStatus: record.status,
    hasActiveLoan: Boolean(currentLoan),
    hasActiveBooking: Boolean(currentBooking),
  });
  const message = typeof pageParams.message === "string" ? pageParams.message : null;
  const error = typeof pageParams.error === "string" ? pageParams.error : null;

  return (
    <AppShell
      title={record.plate_number}
      subtitle="Vehicle borrowing history and current assignment details."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/admin"
      backLabel="Back to admin"
      adminHref="/admin"
    >
      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <section className="panel">
        <div className="calendarPageHeader">
          <div>
            <p className="eyebrow">Vehicle calendar</p>
            <h2>{record.plate_number}</h2>
            <p className="muted">{record.model}</p>
          </div>
        </div>

        <VehicleMonthlyCalendar
          crossYearNextHref={`/admin/vehicles/${record.id}?month=${encodeURIComponent(`${loadedYear + 1}-01`)}`}
          crossYearPreviousHref={`/admin/vehicles/${record.id}?month=${encodeURIComponent(`${loadedYear - 1}-12`)}`}
          events={calendarEvents}
          initialMonth={initialMonth}
          loadedYear={loadedYear}
        />
      </section>

      <section className="panel">
        <div className="sectionHeader compactSectionHeader">
          <div>
            <StatusPill status={displayStatus} />
            <h2>{record.model}</h2>
            <p className="muted">Vehicle ID: {record.id}</p>
          </div>
          <Link className="secondaryButton" href="/admin">
            All vehicles
          </Link>
        </div>

        <div className="detailList">
          <div>
            <strong>Plate number</strong>
            <span>{record.plate_number}</span>
          </div>
          <div>
            <strong>Status</strong>
            <span>{displayStatus}</span>
          </div>
          {optionalFieldSupport.enabled ? (
            <>
              <div>
                <strong>VIN</strong>
                <span>{record.vin || "-"}</span>
              </div>
              <div>
                <strong>Color</strong>
                <span>{record.color || "-"}</span>
              </div>
            </>
          ) : null}
          <div>
            <strong>Current borrower</strong>
            <span>{currentLoan?.borrower_email ?? "-"}</span>
          </div>
          <div>
            <strong>Driver</strong>
            <span>{currentLoan?.driver_name ?? "-"}</span>
          </div>
          <div>
            <strong>Borrowed at</strong>
            <span>{formatDateTime(currentLoan?.borrowed_at ?? null)}</span>
          </div>
          <div>
            <strong>Expected return</strong>
            <span>{formatDateTime(currentLoan?.expected_return_at ?? null)}</span>
          </div>
          <div>
            <strong>Current booking</strong>
            <span>{currentBooking ? `${formatDateTime(currentBooking.starts_at)} to ${formatDateTime(currentBooking.ends_at)}` : "-"}</span>
          </div>
          <div>
            <strong>Booked by</strong>
            <span>{currentBooking?.booked_by_email ?? "-"}</span>
          </div>
          <div>
            <strong>Next booking</strong>
            <span>{nextUpcomingBooking ? `${formatDateTime(nextUpcomingBooking.starts_at)} to ${formatDateTime(nextUpcomingBooking.ends_at)}` : "-"}</span>
          </div>
          <div>
            <strong>Comments</strong>
            <span>{record.comments || "-"}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Create booking</h2>
        <form action={createAdminBooking}>
          <input name="vehicleId" type="hidden" value={record.id} />

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
            <textarea name="comments" placeholder="Campaign, pickup, media event..." />
          </label>

          <SubmitButton className="primaryButton" idleLabel="Create booking" pendingLabel="Saving..." />
        </form>
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Bookings</h2>
          <p className="muted">Admins can adjust booking windows here. Borrow attempts that overlap these windows will be blocked.</p>
        </div>
      </section>

      {bookings.length === 0 ? (
        <div className="emptyState">No bookings have been recorded for this vehicle yet.</div>
      ) : (
        <div className="cardsGrid">
          {bookings.map((booking) => (
            <article className="vehicleCard" key={booking.id}>
              <StatusPill status={new Date(booking.starts_at).getTime() <= now && new Date(booking.ends_at).getTime() > now ? "booked" : "available"} />
              <h3>{booking.booked_by_email}</h3>
              <p className="muted">
                {formatDateTime(booking.starts_at)} to {formatDateTime(booking.ends_at)}
              </p>
              <div className="vehicleMeta">
                <span>Comments: {booking.comments || "-"}</span>
                <span>Created: {formatDateTime(booking.created_at)}</span>
              </div>

              <ConfirmForm action={updateAdminBooking} confirmMessage="Confirm updating this booking?">
                <input name="bookingId" type="hidden" value={booking.id} />
                <input name="vehicleId" type="hidden" value={record.id} />

                <div className="formGrid">
                  <label className="fieldLabel">
                    Start time
                    <input defaultValue={formatUtcIsoForDateTimeLocalInput(booking.starts_at)} name="startsAt" required type="datetime-local" />
                  </label>
                  <label className="fieldLabel">
                    End time
                    <input defaultValue={formatUtcIsoForDateTimeLocalInput(booking.ends_at)} name="endsAt" required type="datetime-local" />
                  </label>
                </div>

                <label className="fieldLabel">
                  Comments
                  <textarea defaultValue={booking.comments ?? ""} name="comments" />
                </label>

                <div className="actionsRow">
                  <SubmitButton className="primaryButton" idleLabel="Update booking" pendingLabel="Saving..." />
                </div>
              </ConfirmForm>

              <ConfirmForm action={deleteAdminBooking} confirmMessage="Confirm deleting this booking? This cannot be undone.">
                <input name="bookingId" type="hidden" value={booking.id} />
                <input name="vehicleId" type="hidden" value={record.id} />
                <SubmitButton className="ghostButton" idleLabel="Delete booking" pendingLabel="Deleting..." />
              </ConfirmForm>
            </article>
          ))}
        </div>
      )}

      <section className="panel">
        <h2>Add past borrow record</h2>
        <p className="muted">Use the admin portal account as borrowed by, then enter the colleague or contact who actually drove the vehicle. Return time can be left blank when the old record does not have one.</p>
        {userRoles.length === 0 ? (
          <div className="emptyState">No users are available yet. Ask the borrower to sign in once, then add the historical record.</div>
        ) : (
          <form action={createHistoricalLoan}>
            <input name="vehicleId" type="hidden" value={record.id} />

            <div className="formGrid">
              <label className="fieldLabel">
                Borrowed by portal account
                <select name="borrowerUserId" required defaultValue={defaultBorrowerUserId}>
                  <option disabled value="">
                    Select a user
                  </option>
                  {userRoles.map((role) => (
                    <option key={role.user_id} value={role.user_id}>
                      {role.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fieldLabel">
                Actual driver
                <input name="driverName" placeholder="Colleague or contact name" required />
              </label>
            </div>

            <label className="fieldLabel">
              Purpose
              <input name="purpose" placeholder="Demo, delivery, service..." required />
            </label>

            <div className="formGrid">
              <label className="fieldLabel">
                Borrowed time
                <input name="borrowedAt" required type="datetime-local" />
              </label>
              <label className="fieldLabel">
                Expected return
                <input name="expectedReturnAt" type="datetime-local" />
              </label>
              <label className="fieldLabel">
                Returned time
                <input name="returnedAt" type="datetime-local" />
              </label>
            </div>

            <div className="formGrid">
              <label className="fieldLabel">
                Start KM
                <input min="0" name="startOdometer" type="number" />
              </label>
              <label className="fieldLabel">
                End KM
                <input min="0" name="endOdometer" type="number" />
              </label>
            </div>

            <div className="formGrid">
              <label className="fieldLabel">
                Borrow notes
                <textarea name="borrowNotes" placeholder="Pickup notes, condition, handover..." />
              </label>
              <label className="fieldLabel">
                Return notes
                <textarea name="returnNotes" placeholder="Return condition, key returned, fuel..." />
              </label>
            </div>

            <SubmitButton className="primaryButton" idleLabel="Add past record" pendingLabel="Saving..." />
          </form>
        )}
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Borrow records</h2>
          <p className="muted">All recorded loans for this vehicle, newest first. Admin-created records can be edited even when return time is blank.</p>
        </div>
      </section>

      {history.length === 0 ? (
        <div className="emptyState">No borrowing history has been recorded for this vehicle yet.</div>
      ) : (
        <div className="cardsGrid">
          {history.map((loan) => (
            <article className="vehicleCard" key={loan.id}>
              <StatusPill status={loan.returned_at ? "available" : "borrowed"} />
              <h3>{loan.borrower_email}</h3>
              <p className="muted">
                {formatDateTime(loan.borrowed_at)} to {formatDateTime(loan.returned_at)}
              </p>
              <div className="vehicleMeta">
                <span>Driver: {loan.driver_name}</span>
                <span>Purpose: {loan.purpose}</span>
                <span>Expected return: {formatDateTime(loan.expected_return_at)}</span>
                <span>Start KM: {loan.start_odometer?.toLocaleString() ?? "-"}</span>
                <span>End KM: {loan.end_odometer?.toLocaleString() ?? "-"}</span>
              </div>

              <details className="extensionDisclosure">
                <summary>Edit borrow record</summary>
                <ConfirmForm action={updateHistoricalLoan} className="extensionForm" confirmMessage="Confirm updating this borrow record?">
                  <input name="loanId" type="hidden" value={loan.id} />
                  <input name="vehicleId" type="hidden" value={record.id} />

                  <div className="formGrid">
                    <label className="fieldLabel">
                        Borrowed by portal account
                      <select name="borrowerUserId" required defaultValue={loan.borrowed_by_user_id}>
                        {userRoles.map((role) => (
                          <option key={role.user_id} value={role.user_id}>
                            {role.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fieldLabel">
                      Actual driver
                      <input defaultValue={loan.driver_name} name="driverName" required />
                    </label>
                  </div>

                    <label className="fieldLabel">
                      Purpose
                      <input defaultValue={loan.purpose} name="purpose" required />
                    </label>

                    <div className="formGrid">
                      <label className="fieldLabel">
                        Borrowed time
                        <input defaultValue={formatUtcIsoForDateTimeLocalInput(loan.borrowed_at)} name="borrowedAt" required type="datetime-local" />
                      </label>
                      <label className="fieldLabel">
                        Expected return
                        <input defaultValue={formatUtcIsoForDateTimeLocalInput(loan.expected_return_at)} name="expectedReturnAt" type="datetime-local" />
                      </label>
                      <label className="fieldLabel">
                        Returned time
                        <input defaultValue={formatUtcIsoForDateTimeLocalInput(loan.returned_at)} name="returnedAt" type="datetime-local" />
                      </label>
                    </div>

                    <div className="formGrid">
                      <label className="fieldLabel">
                        Start KM
                        <input defaultValue={loan.start_odometer ?? ""} min="0" name="startOdometer" type="number" />
                      </label>
                      <label className="fieldLabel">
                        End KM
                        <input defaultValue={loan.end_odometer ?? ""} min="0" name="endOdometer" type="number" />
                      </label>
                    </div>

                    <div className="formGrid">
                      <label className="fieldLabel">
                        Borrow notes
                        <textarea defaultValue={loan.borrow_notes ?? ""} name="borrowNotes" />
                      </label>
                      <label className="fieldLabel">
                        Return notes
                        <textarea defaultValue={loan.return_notes ?? ""} name="returnNotes" />
                      </label>
                    </div>

                  <SubmitButton className="primaryButton" idleLabel="Update record" pendingLabel="Saving..." />
                </ConfirmForm>
              </details>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
