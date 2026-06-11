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

type HistoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];

  return typeof value === "string" ? value.trim() : "";
}

function getExportHref(params: Record<string, string>) {
  const exportParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      exportParams.set(key, value);
    }
  }

  const query = exportParams.toString();

  return query ? `/history/export?${query}` : "/history/export";
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const query = getParam(params, "q").toLowerCase();
  const from = getParam(params, "from");
  const to = getParam(params, "to");
  const status = getParam(params, "status");
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
  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
  const now = Date.now();
  const filteredHistory = history.filter((loan) => {
    const borrowedTime = new Date(loan.borrowed_at).getTime();
    const isOverdue = !loan.returned_at && !loan.is_long_term && loan.expected_return_at && new Date(loan.expected_return_at).getTime() < now;
    const isAdminReturned = Boolean(loan.return_notes?.toLowerCase().includes("admin return by"));
    const searchable = [
      loan.vehicle?.plate_number,
      loan.vehicle?.model,
      loan.borrower_email,
      loan.driver_name,
      loan.purpose,
      loan.borrow_notes,
      loan.return_notes,
    ].filter(Boolean).join(" ").toLowerCase();

    if (query && !searchable.includes(query)) {
      return false;
    }

    if (Number.isFinite(fromTime) && borrowedTime < fromTime) {
      return false;
    }

    if (Number.isFinite(toTime) && borrowedTime > toTime) {
      return false;
    }

    if (status === "active" && loan.returned_at) {
      return false;
    }

    if (status === "returned" && !loan.returned_at) {
      return false;
    }

    if (status === "long-term" && !loan.is_long_term) {
      return false;
    }

    if (status === "overdue" && !isOverdue) {
      return false;
    }

    if (status === "admin-returned" && !isAdminReturned) {
      return false;
    }

    return true;
  });
  const exportHref = getExportHref({ q: query, from, to, status });

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
          <p className="muted">Search by plate, borrower, driver, or purpose. Export follows the current filters.</p>
        </div>
        <Link className="primaryButton" href={exportHref}>
          Export CSV
        </Link>
      </section>

      <section className="panel">
        <form action="/history" className="filterForm">
          <label className="fieldLabel">
            Search
            <input defaultValue={query} name="q" placeholder="Plate, user, driver, purpose..." />
          </label>
          <div className="formGrid">
            <label className="fieldLabel">
              From
              <input defaultValue={from} name="from" type="date" />
            </label>
            <label className="fieldLabel">
              To
              <input defaultValue={to} name="to" type="date" />
            </label>
          </div>
          <label className="fieldLabel">
            Status
            <select defaultValue={status} name="status">
              <option value="">All records</option>
              <option value="active">Active</option>
              <option value="returned">Returned</option>
              <option value="long-term">Long term</option>
              <option value="overdue">Overdue active</option>
              <option value="admin-returned">Admin returned</option>
            </select>
          </label>
          <div className="actionsRow">
            <button className="primaryButton" type="submit">
              Apply filters
            </button>
            <Link className="ghostButton" href="/history">
              Clear
            </Link>
          </div>
        </form>
      </section>

      {loadError ? (
        <p className="message error">{loadError}</p>
      ) : filteredHistory.length === 0 ? (
        <div className="emptyState">No borrowing history matches the current filters.</div>
      ) : (
        <>
          <HistoryBorrowCalendar loans={filteredHistory} />

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
                    {filteredHistory.map((loan) => (
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
