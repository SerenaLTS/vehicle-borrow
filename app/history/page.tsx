import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HistoryBorrowCalendar } from "@/components/history-borrow-calendar";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";

const LOAN_SELECT =
  "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, is_long_term, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)";

function formatReturnedStatus(returnedAt: string | null) {
  return returnedAt ? formatDateTime(returnedAt) : "Not returned yet";
}

export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const [{ data: recentLoans, error: recentLoansError }, { data: activeLoans, error: activeLoansError }, isAdmin] = await Promise.all([
    supabase
      .from("vehicle_loans")
      .select(LOAN_SELECT)
      .order("borrowed_at", { ascending: false })
      .limit(200),
    supabase.from("vehicle_loans").select(LOAN_SELECT).is("returned_at", null).order("borrowed_at", { ascending: false }),
    getIsAdmin(supabase, user.id),
  ]);

  const loadError = recentLoansError?.message ?? activeLoansError?.message ?? null;

  const historyById = new Map<string, RawLoanRow>();

  if (!loadError) {
    for (const loan of [...((recentLoans ?? []) as RawLoanRow[]), ...((activeLoans ?? []) as RawLoanRow[])]) {
      historyById.set(loan.id, loan);
    }
  }

  const history = Array.from(historyById.values())
    .sort((first, second) => new Date(second.borrowed_at).getTime() - new Date(first.borrowed_at).getTime())
    .map(normalizeLoan);

  return (
    <AppShell
      title="History"
      subtitle="Review recent loan records and export a CSV copy."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="sectionHeader">
        <div>
          <h2>Borrowing history</h2>
          <p className="muted">Showing the most recent 200 records plus any active loans.</p>
        </div>
        <Link className="primaryButton" href="/history/export">
          Export CSV
        </Link>
      </section>

      {loadError ? (
        <p className="message error">{loadError}</p>
      ) : history.length === 0 ? (
        <div className="emptyState">No borrowing history has been recorded yet.</div>
      ) : (
        <>
          <HistoryBorrowCalendar loans={history} />

          <section className="historyTableSection">
            <div className="sectionHeader">
              <div>
                <h2>Detailed log</h2>
                <p className="muted">Swipe sideways to view all columns.</p>
              </div>
            </div>
            <div className="tableScrollArea">
              <div className="tableScrollHint" aria-hidden="true">
                <span className="scrollChevron scrollChevron-left" />
                <span className="scrollHintTrack" />
                <span className="scrollChevron scrollChevron-right" />
              </div>
              <div className="tableWrap">
                <table className="historyTable">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Borrower</th>
                      <th>Driver</th>
                      <th>Purpose</th>
                      <th>Borrowed</th>
                      <th>Expected return</th>
                      <th>Returned</th>
                      <th>Status</th>
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
                        <td>{loan.borrower_email}</td>
                        <td>{loan.driver_name}</td>
                        <td>{loan.purpose}</td>
                        <td>{formatDateTime(loan.borrowed_at)}</td>
                        <td>{loan.is_long_term ? "Long term" : formatDateTime(loan.expected_return_at)}</td>
                        <td>{formatReturnedStatus(loan.returned_at)}</td>
                        <td>{loan.returned_at ? "Returned" : "Active"}</td>
                        <td>{loan.start_odometer?.toLocaleString() ?? "-"}</td>
                        <td>{loan.end_odometer?.toLocaleString() ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
