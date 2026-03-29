import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { createAdminBooking, deleteAdminBooking, updateAdminBooking } from "@/app/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { formatUtcIsoForDateTimeLocalInput } from "@/lib/datetime";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName, getVehicleDisplayStatus } from "@/lib/utils";
import { normalizeLoan, normalizeVehicleBooking, type RawLoanRow, type RawVehicleBooking, type Vehicle } from "@/lib/types";

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

  const isAdmin = await getIsAdmin(supabase, user.id);

  if (!isAdmin) {
    redirect("/dashboard?message=Admin access required.");
  }

  const [{ data: vehicle, error: vehicleError }, { data: loanData, error: loansError }, { data: bookingData, error: bookingError }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, model, status, comments, current_holder_user_id")
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

  const record = vehicle as Vehicle;
  const history = ((loanData ?? []) as RawLoanRow[]).map(normalizeLoan);
  const currentLoan = history.find((loan) => loan.returned_at === null) ?? null;
  const bookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
  const now = Date.now();
  const currentBooking = bookings.find((booking) => new Date(booking.starts_at).getTime() <= now && new Date(booking.ends_at).getTime() > now) ?? null;
  const nextUpcomingBooking = bookings.find((booking) => new Date(booking.starts_at).getTime() > now) ?? null;
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

              <form action={updateAdminBooking}>
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
              </form>

              <form action={deleteAdminBooking}>
                <input name="bookingId" type="hidden" value={booking.id} />
                <input name="vehicleId" type="hidden" value={record.id} />
                <SubmitButton className="ghostButton" idleLabel="Delete booking" pendingLabel="Deleting..." />
              </form>
            </article>
          ))}
        </div>
      )}

      <section className="sectionHeader">
        <div>
          <h2>Borrow records</h2>
          <p className="muted">All recorded loans for this vehicle, newest first.</p>
        </div>
      </section>

      {history.length === 0 ? (
        <div className="emptyState">No borrowing history has been recorded for this vehicle yet.</div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Driver</th>
                <th>Purpose</th>
                <th>Borrowed</th>
                <th>Expected return</th>
                <th>Returned</th>
                <th>Start KM</th>
                <th>End KM</th>
              </tr>
            </thead>
            <tbody>
              {history.map((loan) => (
                <tr key={loan.id}>
                  <td>{loan.borrower_email}</td>
                  <td>{loan.driver_name}</td>
                  <td>{loan.purpose}</td>
                  <td>{formatDateTime(loan.borrowed_at)}</td>
                  <td>{formatDateTime(loan.expected_return_at)}</td>
                  <td>{formatDateTime(loan.returned_at)}</td>
                  <td>{loan.start_odometer?.toLocaleString() ?? "-"}</td>
                  <td>{loan.end_odometer?.toLocaleString() ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
