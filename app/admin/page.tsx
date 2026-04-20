import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createVehicle, retireVehicle, updateVehicle } from "@/app/admin/actions";
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

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const isAdmin = await getIsAdmin(supabase, user.id);

  if (!isAdmin) {
    redirect("/dashboard?message=Admin access required.");
  }

  const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);

  const [
    { data: roles, error: rolesError },
    { data: vehicles, error: vehiclesError },
    { data: bookingData, error: bookingError },
  ] = await Promise.all([
    supabase.from("user_roles").select("user_id, email, is_admin, created_at, updated_at").order("email"),
    supabase.from("vehicles").select(getVehicleSelectClause(optionalFieldSupport)).order("plate_number"),
    supabase
      .from("vehicle_bookings")
      .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true }),
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

  const fleet = ((vehicles ?? []) as unknown[]) as Vehicle[];
  const vehicleIds = fleet.map((vehicle) => vehicle.id);
  const { data: activeLoanData, error: activeLoanError } =
    vehicleIds.length > 0
      ? await supabase
          .from("vehicle_loans")
          .select(
            "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)",
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
  const activeOrUpcomingBookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
  const nextBookingByVehicleId = new Map<string, (typeof activeOrUpcomingBookings)[number]>();

  for (const booking of activeOrUpcomingBookings) {
    if (!nextBookingByVehicleId.has(booking.vehicle_id)) {
      nextBookingByVehicleId.set(booking.vehicle_id, booking);
    }
  }

  const message = typeof params.message === "string" ? params.message : null;
  const error = typeof params.error === "string" ? params.error : null;
  const now = Date.now();

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

      <section className="panel">
        <h2>How admin access works</h2>
        <div className="vehicleMeta">
          <span>Open Supabase Table Editor and edit the `public.user_roles` table.</span>
          <span>Set `is_admin` to true for any user who should access this page.</span>
          <span>Do not edit admin access in code. This page only reads the database flag.</span>
        </div>
      </section>

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
              </>
            ) : null}
          </div>

          {!optionalFieldSupport.enabled ? (
            <p className="muted">VIN and color fields will appear after those columns are added to the vehicles table.</p>
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
                <td>{new Date(role.created_at).toLocaleString("en-AU")}</td>
                <td>{new Date(role.updated_at).toLocaleString("en-AU")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="sectionHeader">
        <div>
          <h2>Fleet manager</h2>
          <p className="muted">Edit vehicle details here. Booking windows are now managed from each vehicle record page instead of the manual status dropdown.</p>
        </div>
      </section>

      <div className="cardsGrid">
        {fleet.map((vehicle) => {
          const activeLoan = activeLoanByVehicleId.get(vehicle.id);
          const nextBooking = nextBookingByVehicleId.get(vehicle.id);
          const isActivelyBorrowed = Boolean(activeLoan);
          const isBookingActive = nextBooking ? new Date(nextBooking.starts_at).getTime() <= now && new Date(nextBooking.ends_at).getTime() > now : false;
          const displayStatus = getVehicleDisplayStatus({
            storedStatus: vehicle.status,
            hasActiveLoan: Boolean(activeLoan),
            hasActiveBooking: isBookingActive,
          });

          return (
            <article className="vehicleCard" key={vehicle.id}>
              <div className="vehicleCardHeader">
                <Link className="vehicleCardLink" href={`/admin/vehicles/${vehicle.id}`}>
                  <StatusPill status={displayStatus} />
                  <h3>{vehicle.plate_number}</h3>
                  <p className="muted">{vehicle.model}</p>
                </Link>
                <Link className="secondaryButton" href={`/admin/vehicles/${vehicle.id}`}>
                  View records
                </Link>
              </div>

              {activeLoan ? (
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
                </div>
              ) : null}

              {!activeLoan && nextBooking ? (
                <div className="vehicleMeta borrowedSummary">
                  <span>
                    <strong>Booked by</strong>
                    {nextBooking.booked_by_email}
                  </span>
                  <span>
                    <strong>Booked from</strong>
                    {formatDateTime(nextBooking.starts_at)}
                  </span>
                  <span>
                    <strong>Booked until</strong>
                    {formatDateTime(nextBooking.ends_at)}
                  </span>
                </div>
              ) : null}

              {!activeLoan && nextBooking ? (
                <div className="actionsRow">
                  <Link className="secondaryButton" href={`/admin/vehicles/${vehicle.id}`}>
                    Manage booking
                  </Link>
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
      </div>
    </AppShell>
  );
}
