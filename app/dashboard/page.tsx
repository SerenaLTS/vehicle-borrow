import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { cancelOwnBooking } from "@/app/book/actions";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { normalizeLoan, normalizeVehicleBooking, type RawLoanRow, type RawVehicleBooking } from "@/lib/types";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const isAdmin = await getIsAdmin(supabase, user.id);

  const [{ data: activeLoans }, { count: totalFleetCount }, { data: bookingData }] = await Promise.all([
    supabase
      .from("vehicle_loans")
      .select("id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)")
      .eq("borrowed_by_user_id", user.id)
      .is("returned_at", null)
      .order("borrowed_at", { ascending: false }),
    supabase.from("vehicles").select("id", { count: "exact", head: true }),
    supabase
      .from("vehicle_bookings")
      .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
      .eq("booked_by_user_id", user.id)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true }),
  ]);

  const loans = ((activeLoans ?? []) as RawLoanRow[]).map(normalizeLoan);
  const bookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
  const message = typeof params.message === "string" ? params.message : null;
  const now = Date.now();

  return (
    <AppShell
      title="Dashboard"
      subtitle="Track the current borrowing status of company vehicles."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="sectionHeader">
        <div>
          <h2>Quick actions</h2>
          <p className="muted">Choose what you want to do next.</p>
        </div>
        <div className="actionsRow">
          <Link className="secondaryButton" href="/book">
            Book a vehicle
          </Link>
          <Link className="secondaryButton" href="/borrow">
            Borrow a vehicle
          </Link>
          <Link className="primaryButton" href="/return">
            Return a vehicle
          </Link>
          <Link className="ghostButton" href="/history">
            View history
          </Link>
          {isAdmin ? (
            <Link className="ghostButton" href="/admin">
              Admin
            </Link>
          ) : null}
        </div>
      </section>

      {message ? <p className="message">{message}</p> : null}

      <section className="statsGrid">
        <article className="statCard">
          <p className="statLabel">Vehicles you currently have</p>
          <p className="statValue">{loans.length}</p>
        </article>
        <article className="statCard">
          <p className="statLabel">Total fleet in system</p>
          <p className="statValue">{totalFleetCount ?? 0}</p>
        </article>
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Your active loans</h2>
          <p className="muted">These are the vehicles currently under your responsibility.</p>
        </div>
      </section>

      {loans.length === 0 ? (
        <div className="emptyState">You do not have any vehicles borrowed right now.</div>
      ) : (
        <div className="cardsGrid">
          {loans.map((loan) => (
            <article className="vehicleCard" key={loan.id}>
              <StatusPill status="borrowed" />
              <h3>{loan.vehicle?.plate_number ?? "Unknown vehicle"}</h3>
              <p className="muted">{loan.vehicle?.model ?? "Vehicle"}</p>
              <div className="vehicleMeta">
                <span>Driver: {loan.driver_name}</span>
                <span>Purpose: {loan.purpose}</span>
                <span>Borrowed: {formatDateTime(loan.borrowed_at)}</span>
                <span>Expected return: {formatDateTime(loan.expected_return_at)}</span>
                <span>Start odometer: {loan.start_odometer?.toLocaleString() ?? "-"}{loan.start_odometer !== null ? " km" : ""}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="sectionHeader">
        <div>
          <h2>Your current bookings</h2>
          <p className="muted">Upcoming and active bookings you have made.</p>
        </div>
      </section>

      {bookings.length === 0 ? (
        <div className="emptyState">You do not have any current bookings right now.</div>
      ) : (
        <div className="cardsGrid">
          {bookings.map((booking) => {
            const hasStarted = new Date(booking.starts_at).getTime() <= now;

            return (
              <article className="vehicleCard" key={booking.id}>
                <StatusPill status="booked" />
                <h3>{booking.vehicle?.plate_number ?? "Unknown vehicle"}</h3>
                <p className="muted">{booking.vehicle?.model ?? "Vehicle"}</p>
                <div className="vehicleMeta">
                  <span>From: {formatDateTime(booking.starts_at)}</span>
                  <span>Until: {formatDateTime(booking.ends_at)}</span>
                  <span>Comments: {booking.comments || "-"}</span>
                </div>
                <div className="actionsRow">
                  <Link className="secondaryButton" href={`/book#booking-${booking.id}`}>
                    Edit booking
                  </Link>
                </div>
                {!hasStarted ? (
                  <form action={cancelOwnBooking}>
                    <input name="bookingId" type="hidden" value={booking.id} />
                    <input name="vehicleId" type="hidden" value={booking.vehicle_id} />
                    <SubmitButton className="ghostButton" idleLabel="Cancel booking" pendingLabel="Cancelling..." />
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
