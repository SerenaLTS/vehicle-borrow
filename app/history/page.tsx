import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";

export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data } = await supabase
    .from("vehicle_loans")
    .select("id, vehicle_id, borrowed_by_user_id, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, returned_at, vehicle:vehicles(plate_number, model)")
    .order("borrowed_at", { ascending: false })
    .limit(200);

  const history = ((data ?? []) as RawLoanRow[]).map(normalizeLoan);

  return (
    <AppShell
      title="History"
      subtitle="Review recent loan records and export a CSV copy."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
    >
      <section className="sectionHeader">
        <div>
          <h2>Borrowing history</h2>
          <p className="muted">Showing the most recent 200 records.</p>
        </div>
        <Link className="primaryButton" href="/history/export">
          Export CSV
        </Link>
      </section>

      {history.length === 0 ? (
        <div className="emptyState">No borrowing history has been recorded yet.</div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Driver</th>
                <th>Purpose</th>
                <th>Borrowed</th>
                <th>Returned</th>
                <th>Start KM</th>
                <th>End KM</th>
              </tr>
            </thead>
            <tbody>
              {history.map((loan) => (
                <tr key={loan.id}>
                  <td>
                    {loan.vehicle?.plate_number} <span className="muted">{loan.vehicle?.model}</span>
                  </td>
                  <td>{loan.driver_name}</td>
                  <td>{loan.purpose}</td>
                  <td>{formatDateTime(loan.borrowed_at)}</td>
                  <td>{formatDateTime(loan.returned_at)}</td>
                  <td>{loan.start_odometer.toLocaleString()}</td>
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
