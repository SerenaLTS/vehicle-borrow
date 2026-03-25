import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";

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

  const [{ data: activeLoans }, { count: totalFleetCount }] = await Promise.all([
    supabase
      .from("vehicle_loans")
      .select("id, vehicle_id, borrowed_by_user_id, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)")
      .eq("borrowed_by_user_id", user.id)
      .is("returned_at", null)
      .order("borrowed_at", { ascending: false }),
    supabase.from("vehicles").select("id", { count: "exact", head: true }),
  ]);

  const loans = ((activeLoans ?? []) as RawLoanRow[]).map(normalizeLoan);
  const message = typeof params.message === "string" ? params.message : null;

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
                <span>Start odometer: {loan.start_odometer.toLocaleString()} km</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
