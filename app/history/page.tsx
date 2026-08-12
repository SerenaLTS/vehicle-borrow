import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HistoryBorrowCalendar } from "@/components/history-borrow-calendar";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";
import { getHistoryDateBounds } from "@/lib/history-filters";
import { HistoryPaginationSummary } from "@/components/history-pagination-summary";
import { getSafeActionErrorMessage } from "@/lib/action-errors";

const PAGE_SIZE = 50;

type HistorySearchRow = RawLoanRow & { total_count: number | null };

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

function getPageHref(params: Record<string, string>, page: number) {
  const pageParams = new URLSearchParams(params);
  pageParams.set("page", String(page));
  return `/history?${pageParams.toString()}`;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const query = getParam(params, "q").toLowerCase();
  const from = getParam(params, "from");
  const to = getParam(params, "to");
  const status = getParam(params, "status");
  const requestedPage = Number.parseInt(getParam(params, "page"), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const { fromIso, toExclusiveIso } = getHistoryDateBounds(from, to);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const [{ data: historyRows, error: historyError }, isAdmin] = await Promise.all([
    supabase.rpc("search_vehicle_loan_history", {
      p_query: query,
      p_from: fromIso,
      p_to_exclusive: toExclusiveIso,
      p_status: status,
      p_limit: PAGE_SIZE + 1,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    getIsAdmin(supabase, user.id),
  ]);

  const loadError = historyError
    ? getSafeActionErrorMessage(historyError, "Unable to load borrowing history. Please refresh and try again.", "history:load")
    : null;
  const rows = (historyRows ?? []) as HistorySearchRow[];
  const hasNextPage = rows.length > PAGE_SIZE;
  const filteredHistory = rows.slice(0, PAGE_SIZE).map(normalizeLoan);
  const exportHref = getExportHref({ q: query, from, to, status });

  return (
    <AppShell
      title="History"
      subtitle="Review all loan records and export a CSV copy."
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
      ) : (
        <>
          <HistoryBorrowCalendar query={query} from={from} to={to} status={status} />

          {filteredHistory.length === 0 ? (
            <div className="emptyState">No borrowing history matches the current filters on this page.</div>
          ) : <section className="historyTableSection">
            <div className="sectionHeader">
              <div>
                <h2>Detailed log</h2>
                <HistoryPaginationSummary page={page} query={query} from={from} to={to} status={status} />
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
            {page > 1 || hasNextPage ? (
              <nav aria-label="History pages" className="actionsRow">
                {page > 1 ? <Link className="ghostButton" href={getPageHref({ q: query, from, to, status }, page - 1)}>Previous</Link> : null}
                {hasNextPage ? <Link className="ghostButton" href={getPageHref({ q: query, from, to, status }, page + 1)}>Next</Link> : null}
              </nav>
            ) : null}
          </section>}
        </>
      )}
    </AppShell>
  );
}
