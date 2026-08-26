import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { VehicleMonthlyCalendar } from "@/components/vehicle-monthly-calendar";
import { LoadingLink } from "@/components/loading-link";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { getVehicleCalendarSnapshotForYear } from "@/lib/vehicle-calendar-cache";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";

type VehicleCalendarPageProps = {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function sanitizeBackPath(value: string | null) {
  if (!value || !value.startsWith("/")) {
    return "/dashboard";
  }

  return value;
}

function sanitizeMonth(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return undefined;
  }

  return value;
}

type VehicleAction = "borrow" | "reserve" | null;

function sanitizeAction(value: string | string[] | undefined): VehicleAction {
  return value === "borrow" || value === "reserve" ? value : null;
}

function buildVehicleCalendarHref(vehicleId: string, month: string, from: string, action: VehicleAction) {
  return `/vehicle-calendar/${vehicleId}?month=${encodeURIComponent(month)}&from=${encodeURIComponent(from)}${action ? `&action=${action}` : ""}`;
}

export default async function VehicleCalendarPage({ params, searchParams }: VehicleCalendarPageProps) {
  const { vehicleId } = await params;
  const pageParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const backHref = sanitizeBackPath(typeof pageParams.from === "string" ? pageParams.from : null);
  const requestedMonth = sanitizeMonth(typeof pageParams.month === "string" ? pageParams.month : undefined);
  const requestedYear = Number((requestedMonth ?? `${new Date().getFullYear()}-01`).slice(0, 4));
  const vehicleAction = sanitizeAction(pageParams.action);
  const [isAdmin, calendarSnapshot, { data: loanData, error: loanError }] = await Promise.all([
    getIsAdmin(supabase, user.id),
    getVehicleCalendarSnapshotForYear(supabase, vehicleId, requestedYear),
    supabase
      .from("vehicle_loans")
      .select("id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, is_long_term, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)")
      .eq("vehicle_id", vehicleId)
      .order("borrowed_at", { ascending: false }),
  ]);
  const vehicle = calendarSnapshot.vehicle;

  if (!vehicle) {
    redirect(sanitizeBackPath(typeof pageParams.from === "string" ? pageParams.from : null));
  }

  if (loanError) {
    redirect(`${backHref}?error=${encodeURIComponent("Unable to load vehicle borrow history.")}`);
  }

  const loans = ((loanData ?? []) as RawLoanRow[]).map(normalizeLoan);

  const events = calendarSnapshot.events.map((event) => ({
    ...event,
    notes: event.notes ?? null,
  }));
  const initialMonth = requestedMonth;

  return (
    <AppShell
      title={vehicle.plate_number}
      subtitle="Vehicle calendar"
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref={backHref}
      backLabel="Back"
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="panel">
        <div className="calendarPageHeader">
          <div>
            <p className="eyebrow">Vehicle Calendar</p>
            <h2>{vehicle.plate_number}</h2>
            <p className="muted">{vehicle.model}</p>
          </div>
          {vehicleAction === "reserve" ? (
            <LoadingLink className="primaryButton" href={`/book?vehicleId=${encodeURIComponent(vehicleId)}`}>Reserve this vehicle</LoadingLink>
          ) : vehicleAction === "borrow" ? (
            <LoadingLink className="primaryButton" href={`/borrow?vehicleId=${encodeURIComponent(vehicleId)}`}>Borrow this vehicle</LoadingLink>
          ) : null}
        </div>

        <VehicleMonthlyCalendar
          crossYearNextHref={buildVehicleCalendarHref(vehicleId, `${calendarSnapshot.year + 1}-01`, backHref, vehicleAction)}
          crossYearPreviousHref={buildVehicleCalendarHref(vehicleId, `${calendarSnapshot.year - 1}-12`, backHref, vehicleAction)}
          events={events}
          initialMonth={initialMonth}
          loadedYear={calendarSnapshot.year}
        />
      </section>

      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h2>Borrow history</h2>
            <p className="muted">Read-only records for this vehicle.</p>
          </div>
        </div>

        {loans.length === 0 ? (
          <div className="emptyState">This vehicle has no borrow records yet.</div>
        ) : (
          <div className="cardsGrid">
            {loans.map((loan) => (
              <article className="vehicleCard" key={loan.id}>
                <div className="vehicleCardHeader">
                  <div>
                    <h3>{loan.driver_name || loan.borrower_email}</h3>
                    <p className="muted">Borrowed by {loan.borrower_email}</p>
                  </div>
                  <span className={`pill ${loan.returned_at ? "pill-available" : "pill-borrowed"}`}>
                    {loan.returned_at ? "returned" : loan.is_long_term ? "long term" : "active"}
                  </span>
                </div>
                <div className="vehicleMeta">
                  <span><strong>Purpose</strong>{loan.purpose || "-"}</span>
                  <span><strong>Borrowed at</strong>{formatDateTime(loan.borrowed_at)}</span>
                  <span><strong>Expected return</strong>{loan.is_long_term ? "Long term" : formatDateTime(loan.expected_return_at)}</span>
                  <span><strong>Returned at</strong>{formatDateTime(loan.returned_at)}</span>
                  <span><strong>Start odometer</strong>{loan.start_odometer === null ? "-" : `${loan.start_odometer.toLocaleString()} km`}</span>
                  <span><strong>End odometer</strong>{loan.end_odometer === null ? "-" : `${loan.end_odometer.toLocaleString()} km`}</span>
                  <span><strong>Borrow notes</strong>{loan.borrow_notes || "-"}</span>
                  <span><strong>Return notes</strong>{loan.return_notes || "-"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
