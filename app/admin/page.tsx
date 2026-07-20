import { redirect } from "next/navigation";
import { AdminFleetSearch } from "@/components/admin-fleet-search";
import { AppShell } from "@/components/app-shell";
import { adminReturnVehicle, adminStartReservationBorrow, createVehicle, retireVehicle, updateVehicle } from "@/app/admin/actions";
import { ConfirmForm } from "@/components/confirm-form";
import { LoadingLink } from "@/components/loading-link";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { getVehicleOptionalFieldSupport, getVehicleSelectClause } from "@/lib/vehicle-schema";
import { getIsAdmin, type UserRole } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName, getVehicleDisplayStatus } from "@/lib/utils";
import { normalizeLoan, normalizeVehicleBooking, type RawLoanRow, type RawVehicleBooking, type Vehicle } from "@/lib/types";

type AdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AdminTab = "fleet" | "bookings" | "loans" | "users";

type BookingCancellation = {
  id: string;
  booking_id: string;
  vehicle_plate_number: string | null;
  vehicle_model: string | null;
  booked_by_email: string;
  starts_at: string;
  ends_at: string | null;
  is_long_term: boolean;
  booking_comments: string | null;
  cancelled_by_email: string;
  cancelled_by_admin: boolean;
  cancellation_note: string | null;
  cancelled_at: string;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const [isAdmin, optionalFieldSupport] = await Promise.all([
    getIsAdmin(supabase, user.id),
    getVehicleOptionalFieldSupport(supabase),
  ]);

  if (!isAdmin) {
    redirect("/dashboard?message=Admin access required.");
  }

  const [
    { data: roles, error: rolesError },
    { data: vehicles, error: vehiclesError },
    { data: bookingData, error: bookingError },
    { data: cancellationData, error: cancellationError },
  ] = await Promise.all([
    supabase.from("user_roles").select("user_id, email, is_admin, created_at, updated_at").order("email"),
    supabase.from("vehicles").select(getVehicleSelectClause(optionalFieldSupport)).order("plate_number"),
    supabase
      .from("vehicle_bookings")
      .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, is_long_term, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
      .order("starts_at", { ascending: true }),
    supabase
      .from("booking_cancellations")
      .select("id, booking_id, vehicle_plate_number, vehicle_model, booked_by_email, starts_at, ends_at, is_long_term, booking_comments, cancelled_by_email, cancelled_by_admin, cancellation_note, cancelled_at")
      .order("cancelled_at", { ascending: false })
      .limit(100),
  ]);

  if (rolesError) {
    redirect(`/admin?error=${encodeURIComponent(rolesError.message)}`);
  }

  if (vehiclesError) {
    redirect(`/admin?error=${encodeURIComponent(vehiclesError.message)}`);
  }

  if (bookingError) {
    redirect(`/admin?error=${encodeURIComponent(bookingError.message)}`);
  }

  if (cancellationError) {
    redirect(`/admin?error=${encodeURIComponent(cancellationError.message)}`);
  }

  const fleet = ((vehicles ?? []) as unknown[]) as Vehicle[];
  const vehicleIds = fleet.map((vehicle) => vehicle.id);
  const { data: activeLoanData, error: activeLoanError } =
    vehicleIds.length > 0
      ? await supabase
          .from("vehicle_loans")
          .select(
            "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, is_long_term, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)",
          )
          .in("vehicle_id", vehicleIds)
          .is("returned_at", null)
      : { data: [], error: null };

  if (activeLoanError) {
    redirect(`/admin?error=${encodeURIComponent(activeLoanError.message)}`);
  }

  const userRoles = (roles ?? []) as UserRole[];
  const activeLoans = ((activeLoanData ?? []) as RawLoanRow[]).map(normalizeLoan);
  const activeLoanByVehicleId = new Map(activeLoans.map((loan) => [loan.vehicle_id, loan]));
  const activeOrUpcomingBookings = ((bookingData ?? []) as RawVehicleBooking[])
    .map(normalizeVehicleBooking)
    .filter((booking) => booking.is_long_term || (booking.ends_at ? new Date(booking.ends_at).getTime() >= Date.now() : false));
  const bookingCancellations = (cancellationData ?? []) as BookingCancellation[];
  const nextBookingByVehicleId = new Map<string, (typeof activeOrUpcomingBookings)[number]>();

  for (const booking of activeOrUpcomingBookings) {
    if (!nextBookingByVehicleId.has(booking.vehicle_id)) {
      nextBookingByVehicleId.set(booking.vehicle_id, booking);
    }
  }

  const message = typeof params.message === "string" ? params.message : null;
  const error = typeof params.error === "string" ? params.error : null;
  const now = Date.now();
  const activeTab = params.tab === "bookings" || params.tab === "loans" || params.tab === "users" ? params.tab : "fleet";
  const tabHref = (tab: AdminTab) => `/admin${tab === "fleet" ? "" : `?tab=${tab}`}`;
  const overdueLoans = activeLoans.filter((loan) => !loan.is_long_term && loan.expected_return_at && new Date(loan.expected_return_at).getTime() < now);
  const longTermLoans = activeLoans.filter((loan) => loan.is_long_term);
  const startedUnconvertedBookings = activeOrUpcomingBookings.filter((booking) => {
    const startsAt = new Date(booking.starts_at).getTime();
    const endsAt = booking.ends_at ? new Date(booking.ends_at).getTime() : Number.POSITIVE_INFINITY;

    return startsAt <= now && (booking.is_long_term || endsAt > now);
  });

  return (
    <AppShell
      title="Admin"
      subtitle="Review users and fleet records. Admin access is controlled from Supabase."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref="/admin"
    >
      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <nav className="tabNav" aria-label="Admin sections">
        <LoadingLink className={activeTab === "fleet" ? "tabLink activeTabLink" : "tabLink"} href={tabHref("fleet")}>
          Fleet
        </LoadingLink>
        <LoadingLink className={activeTab === "bookings" ? "tabLink activeTabLink" : "tabLink"} href={tabHref("bookings")}>
          Bookings
        </LoadingLink>
        <LoadingLink className={activeTab === "loans" ? "tabLink activeTabLink" : "tabLink"} href={tabHref("loans")}>
          Loans
        </LoadingLink>
        <LoadingLink className={activeTab === "users" ? "tabLink activeTabLink" : "tabLink"} href={tabHref("users")}>
          Users
        </LoadingLink>
      </nav>

      <section className="statsGrid adminStatsGrid">
        <article className="statCard">
          <p className="statLabel">Active loans</p>
          <p className="statValue">{activeLoans.length}</p>
        </article>
        <article className="statCard">
          <p className="statLabel">Overdue</p>
          <p className="statValue">{overdueLoans.length}</p>
        </article>
        <article className="statCard">
          <p className="statLabel">Started reservations</p>
          <p className="statValue">{startedUnconvertedBookings.length}</p>
        </article>
      </section>

      {activeTab === "users" ? (
        <>
      <section className="panel">
        <h2>How admin access works</h2>
        <div className="vehicleMeta">
          <span>Open Supabase Table Editor and edit the `public.user_roles` table.</span>
          <span>Set `is_admin` to true for any user who should access this page.</span>
          <span>Do not edit admin access in code. This page only reads the database flag.</span>
        </div>
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Users</h2>
          <p className="muted">Users appear here automatically after they sign up or after the schema backfill runs.</p>
        </div>
      </section>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Admin</th>
              <th>Joined</th>
              <th>Last synced</th>
            </tr>
          </thead>
          <tbody>
            {userRoles.map((role) => (
              <tr key={role.user_id}>
                <td>{role.email}</td>
                <td>{role.is_admin ? "Yes" : "No"}</td>
                <td>{formatDateTime(role.created_at)}</td>
                <td>{formatDateTime(role.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </>
      ) : null}

      {activeTab === "fleet" ? (
        <>
      <section className="panel">
        <h2>Add vehicle</h2>
        <form action={createVehicle}>
          <div className="formGrid">
            <label className="fieldLabel">
              Plate number
              <input name="plateNumber" placeholder="ABC123" required />
            </label>
            <label className="fieldLabel">
              Model
              <input name="model" placeholder="T9 PHEV" required />
            </label>
            {optionalFieldSupport.enabled ? (
              <>
                <label className="fieldLabel">
                  VIN
                  <input name="vin" placeholder="LGWXXXXXXXXXXXXXX" />
                </label>
                <label className="fieldLabel">
                  Color
                  <input name="color" placeholder="White" />
                </label>
                <label className="fieldLabel">
                  Location
                  <input name="location" placeholder="Sydney office, warehouse..." />
                </label>
              </>
            ) : null}
          </div>

          {!optionalFieldSupport.enabled ? (
            <p className="muted">VIN, color, and location fields will appear after those columns are added to the vehicles table.</p>
          ) : null}

          <label className="fieldLabel">
            Status
            <select defaultValue="available" name="status" required>
              <option value="available">available</option>
              <option value="maintenance">maintenance</option>
              <option value="retired">retired</option>
            </select>
          </label>

          <label className="fieldLabel">
            Comments
            <textarea name="comments" placeholder="Booked for next week, service notes, or anything the team should know" />
          </label>

          <SubmitButton className="primaryButton" idleLabel="Add vehicle" pendingLabel="Adding..." />
        </form>
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Fleet manager</h2>
          <p className="muted">Edit vehicle details here. Reservation windows are managed from each vehicle record page.</p>
        </div>
      </section>

      <AdminFleetSearch totalCount={fleet.length}>
        {fleet.map((vehicle) => {
          const activeLoan = activeLoanByVehicleId.get(vehicle.id);
          const nextBooking = nextBookingByVehicleId.get(vehicle.id);
          const isActivelyBorrowed = Boolean(activeLoan);
          const isBookingActive = nextBooking
            ? new Date(nextBooking.starts_at).getTime() <= now && (nextBooking.is_long_term || (nextBooking.ends_at ? new Date(nextBooking.ends_at).getTime() > now : false))
            : false;
          const displayStatus = getVehicleDisplayStatus({
            storedStatus: vehicle.status,
            hasActiveLoan: Boolean(activeLoan),
            hasCurrentHolder: Boolean(vehicle.current_holder_user_id),
            hasActiveBooking: isBookingActive,
          });

          return (
            <article
              className="vehicleCard"
              data-fleet-card
              data-search={[
                "rego",
                "registration",
                "plate",
                "vin",
                "colour",
                "color",
                "model",
                "location",
                vehicle.plate_number,
                vehicle.model,
                vehicle.vin,
                vehicle.color,
                vehicle.location,
                vehicle.comments,
                activeLoan?.borrower_email,
                activeLoan?.driver_name,
                nextBooking?.booked_by_email,
              ].filter(Boolean).join(" ")}
              key={vehicle.id}
            >
              <div className="vehicleCardHeader">
                <LoadingLink className="vehicleCardLink" href={`/admin/vehicles/${vehicle.id}`}>
                  <StatusPill status={displayStatus} />
                  <h3>{vehicle.plate_number}</h3>
                  <p className="muted">{vehicle.model}</p>
                  {vehicle.location ? <p className="muted">Location: {vehicle.location}</p> : null}
                </LoadingLink>
                <LoadingLink className="secondaryButton" href={`/admin/vehicles/${vehicle.id}`}>
                  View records
                </LoadingLink>
              </div>

              {activeLoan ? (
                <>
                  <div className="vehicleMeta borrowedSummary">
                    <span>
                      <strong>Borrower</strong>
                      {activeLoan.borrower_email}
                    </span>
                    <span>
                      <strong>Borrowed at</strong>
                      {formatDateTime(activeLoan.borrowed_at)}
                    </span>
                    <span>
                      <strong>Driver</strong>
                      {activeLoan.driver_name || "-"}
                    </span>
                    <span>
                      <strong>Start odometer</strong>
                      {activeLoan.start_odometer?.toLocaleString() ?? "-"}{activeLoan.start_odometer !== null ? " km" : ""}
                    </span>
                  </div>

                  <details className="extensionDisclosure adminReturnDisclosure">
                    <summary>Admin return</summary>
                    <ConfirmForm
                      action={adminReturnVehicle}
                      className="extensionForm"
                      confirmMessage="Confirm admin return? This will close the active borrow record and make the vehicle available."
                    >
                      <input name="vehicleId" type="hidden" value={vehicle.id} />
                      <input name="loanId" type="hidden" value={activeLoan.id} />
                      <label className="fieldLabel">
                        Return odometer
                        <input
                          min={activeLoan.start_odometer ?? 0}
                          name="endOdometer"
                          placeholder={activeLoan.start_odometer !== null ? `${activeLoan.start_odometer}` : "Optional"}
                          type="number"
                        />
                      </label>
                      <label className="fieldLabel">
                        Admin return note
                        <textarea name="returnNotes" placeholder="Borrower forgot to return in system, confirmed key/vehicle returned..." required />
                      </label>
                      <SubmitButton className="primaryButton" idleLabel="Return vehicle" pendingLabel="Returning..." />
                    </ConfirmForm>
                  </details>
                </>
              ) : null}

              {!activeLoan && nextBooking ? (
                <div className="vehicleMeta borrowedSummary">
                  <span>
                    <strong>Reserved by</strong>
                    {nextBooking.booked_by_email}
                  </span>
                  <span>
                    <strong>Reserved from</strong>
                    {formatDateTime(nextBooking.starts_at)}
                  </span>
                  <span>
                    <strong>Reserved until</strong>
                    {nextBooking.is_long_term ? "Long term" : formatDateTime(nextBooking.ends_at)}
                  </span>
                </div>
              ) : null}
              <form action={updateVehicle}>
                <input name="vehicleId" type="hidden" value={vehicle.id} />

                <label className="fieldLabel">
                  Model
                  <input defaultValue={vehicle.model} name="model" required />
                </label>

                {optionalFieldSupport.enabled ? (
                  <div className="formGrid">
                    <label className="fieldLabel">
                      VIN
                      <input defaultValue={vehicle.vin ?? ""} name="vin" placeholder="LGWXXXXXXXXXXXXXX" />
                    </label>

                    <label className="fieldLabel">
                      Color
                      <input defaultValue={vehicle.color ?? ""} name="color" placeholder="White" />
                    </label>

                    <label className="fieldLabel">
                      Location
                      <input defaultValue={vehicle.location ?? ""} name="location" placeholder="Sydney office, warehouse..." />
                    </label>
                  </div>
                ) : null}

                <label className="fieldLabel">
                  Status
                  {isActivelyBorrowed ? (
                    <p className="muted">borrowed</p>
                  ) : (
                    <select
                      defaultValue={vehicle.status === "maintenance" || vehicle.status === "retired" ? vehicle.status : "available"}
                      name="status"
                      required
                    >
                      <option value="available">available</option>
                      <option value="maintenance">maintenance</option>
                      <option value="retired">retired</option>
                    </select>
                  )}
                </label>

                <label className="fieldLabel">
                  Comments
                  <textarea
                    defaultValue={vehicle.comments ?? ""}
                    name="comments"
                    placeholder="Booking details, issues, handover notes..."
                  />
                </label>

                <div className="actionsRow">
                  <SubmitButton className="primaryButton" idleLabel="Save changes" pendingLabel="Saving..." />
                </div>
              </form>

              {!isActivelyBorrowed ? (
                <form action={retireVehicle}>
                  <input name="vehicleId" type="hidden" value={vehicle.id} />
                  <SubmitButton className="ghostButton" idleLabel="Mark as retired" pendingLabel="Retiring..." />
                </form>
              ) : (
                <p className="muted">Return this vehicle before retiring it.</p>
              )}
            </article>
          );
        })}
      </AdminFleetSearch>
        </>
      ) : null}

      {activeTab === "bookings" ? (
        <>
          <section className="sectionHeader">
            <div>
              <h2>Reservations</h2>
              <p className="muted">All active and upcoming reservations across the fleet.</p>
            </div>
          </section>

          {startedUnconvertedBookings.length > 0 ? (
            <section className="actionRequiredPanel">
              <div>
                <p className="actionRequiredLabel">Action needed</p>
                <h2>Started reservations not converted</h2>
                <p>These reservations have started but have not been converted with Start borrow.</p>
              </div>
              <div className="actionRequiredList">
                {startedUnconvertedBookings.map((booking) => (
                  <article className="actionRequiredItem" key={booking.id}>
                    <div>
                      <strong>{booking.vehicle?.plate_number ?? "Unknown vehicle"}</strong>
                      <span>{booking.booked_by_email}</span>
                      <span>{formatDateTime(booking.starts_at)} to {booking.is_long_term ? "Long term" : formatDateTime(booking.ends_at)}</span>
                    </div>
                    <LoadingLink className="secondaryButton" href={`/admin/vehicles/${booking.vehicle_id}`}>
                      Open vehicle
                    </LoadingLink>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {activeOrUpcomingBookings.length === 0 ? (
            <div className="emptyState">No active or upcoming reservations.</div>
          ) : (
            <div className="cardsGrid">
              {activeOrUpcomingBookings.map((booking) => {
                const hasStarted = new Date(booking.starts_at).getTime() <= now;
                const isActiveReservation = hasStarted && (booking.is_long_term || (booking.ends_at ? new Date(booking.ends_at).getTime() > now : false));

                return (
                  <article className="vehicleCard" key={booking.id}>
                    <StatusPill status="booked" />
                    <h3>{booking.vehicle?.plate_number ?? "Unknown vehicle"}</h3>
                    <p className="muted">{booking.vehicle?.model ?? "Vehicle"}</p>
                    <div className="vehicleMeta">
                      <span>Reserved for: {booking.booked_by_email}</span>
                      <span>From: {formatDateTime(booking.starts_at)}</span>
                      <span>Until: {booking.is_long_term ? "Long term" : formatDateTime(booking.ends_at)}</span>
                      <span>Comments: {booking.comments || "-"}</span>
                    </div>
                    <div className="actionsRow">
                      <LoadingLink className="secondaryButton" href={`/admin/vehicles/${booking.vehicle_id}`}>
                        Manage
                      </LoadingLink>
                      {isActiveReservation ? (
                        <ConfirmForm action={adminStartReservationBorrow} confirmMessage="Start this reservation as an active borrow for the reserved user?">
                          <input name="bookingId" type="hidden" value={booking.id} />
                          <input name="vehicleId" type="hidden" value={booking.vehicle_id} />
                          <SubmitButton className="primaryButton" idleLabel="Start borrow" pendingLabel="Starting..." />
                        </ConfirmForm>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <section className="sectionHeader">
            <div>
              <h2>Cancellation audit</h2>
              <p className="muted">The 100 most recent reservation cancellations. Audit records are retained after the original booking is deleted.</p>
            </div>
          </section>

          {bookingCancellations.length === 0 ? (
            <div className="emptyState">No reservation cancellations have been recorded yet.</div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Reserved for</th>
                    <th>Reserved time</th>
                    <th>Cancelled by</th>
                    <th>Cancelled at</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {bookingCancellations.map((cancellation) => (
                    <tr key={cancellation.id}>
                      <td>{[cancellation.vehicle_plate_number, cancellation.vehicle_model].filter(Boolean).join(" • ") || "Deleted vehicle"}</td>
                      <td>{cancellation.booked_by_email}</td>
                      <td>{formatDateTime(cancellation.starts_at)} to {cancellation.is_long_term ? "Long term" : formatDateTime(cancellation.ends_at)}</td>
                      <td>{cancellation.cancelled_by_email}{cancellation.cancelled_by_admin ? " (Admin)" : ""}</td>
                      <td>{formatDateTime(cancellation.cancelled_at)}</td>
                      <td>{cancellation.cancellation_note || cancellation.booking_comments || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {activeTab === "loans" ? (
        <>
          {overdueLoans.length > 0 ? (
            <section className="actionRequiredPanel">
              <div>
                <p className="actionRequiredLabel">Overdue</p>
                <h2>Vehicles past expected return</h2>
                <p>These active loans need a return or an extension.</p>
              </div>
              <div className="actionRequiredList">
                {overdueLoans.map((loan) => (
                  <article className="actionRequiredItem" key={loan.id}>
                    <div>
                      <strong>{loan.vehicle?.plate_number ?? "Unknown vehicle"}</strong>
                      <span>{loan.borrower_email}</span>
                      <span>Expected: {formatDateTime(loan.expected_return_at)}</span>
                    </div>
                    <LoadingLink className="secondaryButton" href={`/admin/vehicles/${loan.vehicle_id}`}>
                      Open vehicle
                    </LoadingLink>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="sectionHeader">
            <div>
              <h2>Active loans</h2>
              <p className="muted">Currently borrowed vehicles, including overdue and long-term loans.</p>
            </div>
          </section>

          {activeLoans.length === 0 ? (
            <div className="emptyState">No active loans right now.</div>
          ) : (
            <div className="cardsGrid">
              {activeLoans.map((loan) => {
                const isOverdue = !loan.is_long_term && loan.expected_return_at && new Date(loan.expected_return_at).getTime() < now;

                return (
                  <article className={isOverdue ? "vehicleCard activeBookingCard" : "vehicleCard"} key={loan.id}>
                    <StatusPill status="borrowed" />
                    <h3>{loan.vehicle?.plate_number ?? "Unknown vehicle"}</h3>
                    <p className="muted">{loan.vehicle?.model ?? "Vehicle"}</p>
                    <div className="vehicleMeta">
                      <span>Borrower: {loan.borrower_email}</span>
                      <span>Driver: {loan.driver_name || "-"}</span>
                      <span>Borrowed: {formatDateTime(loan.borrowed_at)}</span>
                      <span>Expected return: {loan.is_long_term ? "Long term" : formatDateTime(loan.expected_return_at)}</span>
                      <span>Purpose: {loan.purpose}</span>
                    </div>
                    <LoadingLink className="secondaryButton" href={`/admin/vehicles/${loan.vehicle_id}`}>
                      Manage
                    </LoadingLink>
                  </article>
                );
              })}
            </div>
          )}

          {longTermLoans.length > 0 ? (
            <>
              <section className="sectionHeader">
                <div>
                  <h2>Long-term loans</h2>
                  <p className="muted">Active loans without a scheduled return time.</p>
                </div>
              </section>
              <div className="cardsGrid">
                {longTermLoans.map((loan) => (
                  <article className="vehicleCard" key={loan.id}>
                    <StatusPill status="borrowed" />
                    <h3>{loan.vehicle?.plate_number ?? "Unknown vehicle"}</h3>
                    <p className="muted">{loan.borrower_email}</p>
                    <div className="vehicleMeta">
                      <span>Driver: {loan.driver_name || "-"}</span>
                      <span>Borrowed: {formatDateTime(loan.borrowed_at)}</span>
                      <span>Purpose: {loan.purpose}</span>
                    </div>
                    <LoadingLink className="secondaryButton" href={`/admin/vehicles/${loan.vehicle_id}`}>
                      Manage
                    </LoadingLink>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
